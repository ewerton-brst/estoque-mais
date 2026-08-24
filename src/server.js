import { createServer, STATUS_CODES } from 'node:http';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { extname, isAbsolute, join, normalize, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { networkInterfaces } from 'node:os';
const scrypt = promisify(scryptCallback);
const root = join(fileURLToPath(new URL('.', import.meta.url)), 'views');
const dataDir = join(root, '..', 'data');
const usersFile = join(dataDir, 'users.json');
const inventoryFile = join(dataDir, 'inventory.json');
const companiesFile = join(dataDir, 'companies.json');
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const roles = ['admin', 'manager', 'operator', 'viewer'];
const sessionsFile = join(dataDir, 'sessions.json');
const SESSION_TTL = 7 * 24 * 60 * 60 * 1000;
const loadSessions = async () => {
    try {
        const stored = JSON.parse(await readFile(sessionsFile, 'utf8'));
        return new Map(stored.filter(([token, session]) => token && session?.userId && Date.now() - session.createdAt < SESSION_TTL));
    } catch { return new Map(); }
};
const sessions = await loadSessions();
const persistSessions = () => { const now = Date.now(); for (const [token, session] of [...sessions]) if (!session?.createdAt || now - session.createdAt > SESSION_TTL) sessions.delete(token); writeFile(sessionsFile, JSON.stringify([...sessions], null, 2)).catch(() => {}); };
const loginAttempts = new Map();
const LOGIN_LIMIT = 5;
const LOGIN_WINDOW = 10 * 60 * 1000;
const BODY_LIMIT = 2 * 1024 * 1024;
const securityHeaders = (contentType) => ({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer', ...(String(contentType).startsWith('text/html') ? { 'Content-Security-Policy': "default-src 'self'; script-src 'self' https://unpkg.com https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'" } : {}) });
setInterval(() => { const now = Date.now(); for (const [key, attempt] of [...loginAttempts]) if ((attempt.blockedUntil && attempt.blockedUntil < now) || (!attempt.blockedUntil && now - (attempt.lastAt ?? 0) > LOGIN_WINDOW)) loginAttempts.delete(key); }, 5 * 60 * 1000).unref();
let inventoryWriteQueue = Promise.resolve();

async function hashPassword(password) {
    const salt = randomBytes(16);
    const derived = await scrypt(password, salt, 64);
    return `scrypt:${salt.toString('hex')}:${derived.toString('hex')}`;
}

async function verifyPassword(password, stored) {
    const [, saltHex, hashHex] = stored.split(':');
    const derived = await scrypt(password, Buffer.from(saltHex, 'hex'), 64);
    return timingSafeEqual(derived, Buffer.from(hashHex, 'hex'));
}

async function readUsers() {
    try {
        const users = JSON.parse(await readFile(usersFile, 'utf8'));
        return users.map((user) => ({ ...user, exportReports: user.exportReports ?? user.role === 'admin', companyIds: user.companyIds ?? (user.role === 'admin' ? ['*'] : ['default']) }));
    } catch {
        await mkdir(dataDir, { recursive: true });
        const initial = [{ id: randomUUID(), name: 'Administrador', username: 'admin', role: 'admin', active: true, exportReports: true, companyIds: ['*'], profileImage: '', passwordHash: await hashPassword('admin') }];
        await writeFile(usersFile, JSON.stringify(initial, null, 2));
        return initial;
    }
}

async function readInventory() {
    return readCompanyInventory('default');
}

async function readCompanies() {
    try { return JSON.parse(await readFile(companiesFile, 'utf8')); } catch {
        const initial = [{ id: 'default', name: 'BRSTEC', active: true }];
        await mkdir(dataDir, { recursive: true });
        await writeFile(companiesFile, JSON.stringify(initial, null, 2));
        return initial;
    }
}

async function readCompanyInventory(companyId) {
    const companyFile = join(dataDir, `inventory-${companyId}.json`);
    try { return JSON.parse(await readFile(companyFile, 'utf8')); } catch {
        const initial = {
            products: [
                { id: 1, name: 'Kit organizador modular', sku: 'ALV-1042', category: 'Organização', quantity: 86, minimum: 20, price: 89.9 },
                { id: 2, name: 'Cafeteira italiana 6 xícaras', sku: 'ALV-0987', category: 'Cozinha', quantity: 24, minimum: 15, price: 129.9 },
                { id: 3, name: 'Jogo de cama algodão', sku: 'ALV-1178', category: 'Têxtil', quantity: 7, minimum: 12, price: 159.9 },
                { id: 4, name: 'Vaso cerâmica terracota', sku: 'ALV-0821', category: 'Casa & decoração', quantity: 42, minimum: 10, price: 74.5 },
                { id: 5, name: 'Tábua de corte bambu', sku: 'ALV-1254', category: 'Cozinha', quantity: 0, minimum: 8, price: 64.9 },
                { id: 6, name: 'Cesto de fibra natural', sku: 'ALV-1106', category: 'Organização', quantity: 18, minimum: 10, price: 109.9 }
            ],
            movements: [],
            productAudits: []
        };
        await mkdir(dataDir, { recursive: true });
        if (companyId === 'default') {
            try { await writeFile(companyFile, await readFile(inventoryFile)); } catch { await writeFile(companyFile, JSON.stringify(initial, null, 2)); }
        } else await writeFile(companyFile, JSON.stringify(initial, null, 2));
        return initial;
    }
}

function writeInventory(inventory) {
    inventoryWriteQueue = inventoryWriteQueue.then(() => writeFile(inventory.file, JSON.stringify(inventory.data, null, 2)));
    return inventoryWriteQueue;
}

const publicUser = ({ passwordHash, ...user }) => user;
const body = (request) => new Promise((resolve, reject) => {
    let value = '';
    let size = 0;
    let done = false;
    const finish = (fn) => { if (done) return; done = true; fn(); };
    const tooLarge = () => finish(() => { const error = new Error('Corpo da requisição excede o limite permitido.'); error.statusCode = 413; reject(error); });
    request.on('data', (chunk) => {
        if (done) return;
        size += chunk.length;
        if (size > BODY_LIMIT) {
            request.resume();
            request.once('end', tooLarge);
            request.once('close', tooLarge);
            request.once('error', tooLarge);
            setTimeout(tooLarge, 3000).unref();
            return;
        }
        value += chunk;
    });
    request.on('end', () => finish(() => {
        if (!value.trim()) return resolve({});
        try { resolve(JSON.parse(value)); } catch { const error = new Error('Corpo da requisição não é um JSON válido.'); error.statusCode = 400; reject(error); }
    }));
    request.on('error', () => finish(() => { const error = new Error('Erro ao ler o corpo da requisição.'); error.statusCode = 400; reject(error); }));
});
const cookies = (request) => Object.fromEntries((request.headers.cookie || '').split(';').filter(Boolean).map((cookie) => cookie.trim().split('=')));
const sendJson = (response, status, value, extra = {}) => { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra }); response.end(JSON.stringify(value)); };
const currentUser = (request, users) => { const session = sessions.get(cookies(request).estoque_session); if (!session || Date.now() - session.createdAt > SESSION_TTL) return undefined; return users.find((user) => session.userId === user.id && user.active); };
const allowed = (user, minimum) => roles.indexOf(user?.role) <= roles.indexOf(minimum);

async function handleApi(request, response, pathname) {
    const users = await readUsers();
    if (request.method === 'GET' && pathname === '/api/companies') return sendJson(response, 200, (await readCompanies()).filter((company) => company.active));
    if (request.method === 'POST' && pathname === '/api/login') {
        const { username, password, companyId } = await body(request);
        const attemptKey = `${String(username ?? '').toLowerCase()}|${request.socket.remoteAddress}`;
        const attempt = loginAttempts.get(attemptKey);
        if (attempt?.blockedUntil > Date.now()) return sendJson(response, 429, { error: 'Muitas tentativas de login. Aguarde alguns minutos e tente novamente.' });
        const user = users.find((item) => item.username === username && item.active);
        if (!user) await hashPassword('tempo-equalizado');
        if (!user || !(await verifyPassword(password, user.passwordHash))) {
            const failures = (attempt?.failures ?? 0) + 1;
            loginAttempts.set(attemptKey, { failures, blockedUntil: failures >= LOGIN_LIMIT ? Date.now() + LOGIN_WINDOW : 0, lastAt: Date.now() });
            return sendJson(response, 401, { error: 'Usuário ou senha inválidos.' });
        }
        loginAttempts.delete(attemptKey);
        if (user.username === 'admin' && companyId !== 'default') return sendJson(response, 403, { error: 'O usuário master admin só pode entrar na empresa BRSTEC.' });
        const company = (await readCompanies()).find((item) => item.id === companyId && item.active);
        if (!company || (user.role !== 'admin' && !user.companyIds.includes(companyId))) return sendJson(response, 403, { error: 'Usuário sem acesso a esta empresa.' });
        const token = randomBytes(32).toString('hex'); sessions.set(token, { userId: user.id, companyId, createdAt: Date.now() }); persistSessions();
        return sendJson(response, 200, { user: publicUser(user), company, mustChangePassword: user.mustChangePassword === true }, { 'Set-Cookie': `estoque_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL / 1000}` });
    }
    if (request.method === 'POST' && pathname === '/api/logout') {
        sessions.delete(cookies(request).estoque_session); persistSessions(); return sendJson(response, 200, { ok: true });
    }
    const user = currentUser(request, users);
    if (pathname === '/api/session' && request.method === 'GET') return user ? sendJson(response, 200, { user: publicUser(user), company: (await readCompanies()).find((company) => company.id === sessions.get(cookies(request).estoque_session)?.companyId), mustChangePassword: user.mustChangePassword === true }) : sendJson(response, 401, { error: 'Não autenticado.' });
    if (!user) return sendJson(response, 401, { error: 'Faça login para continuar.' });
    const selectedCompany = (await readCompanies()).find((company) => company.id === (sessions.get(cookies(request).estoque_session)?.companyId));
    if (pathname === '/api/account/password' && request.method === 'POST') {
        const { password } = await body(request);
        if (!password || password.length < 6) return sendJson(response, 400, { error: 'A nova senha deve ter pelo menos 6 caracteres.' });
        user.passwordHash = await hashPassword(password); user.mustChangePassword = false;
        await writeFile(usersFile, JSON.stringify(users, null, 2)); return sendJson(response, 200, { user: publicUser(user) });
    }
    if (pathname === '/api/inventory' && request.method === 'GET') return sendJson(response, 200, await readCompanyInventory(selectedCompany.id));
    if (pathname === '/api/inventory' && request.method === 'PUT') {
        if (!allowed(user, 'operator')) return sendJson(response, 403, { error: 'Seu usuário não pode alterar o estoque.' });
        const inventory = await body(request);
        const validProduct = (product) => Boolean(product) && typeof product.name === 'string' && product.name.trim().length > 0 && typeof product.sku === 'string' && Number.isFinite(product.quantity) && product.quantity >= 0 && Number.isFinite(product.minimum) && product.minimum >= 0 && Number.isFinite(product.price) && product.price >= 0;
        if (!Array.isArray(inventory.products) || !Array.isArray(inventory.movements) || !Array.isArray(inventory.productAudits) || !inventory.products.every(validProduct)) return sendJson(response, 400, { error: 'Dados de estoque inválidos.' });
        await writeInventory({ file: join(dataDir, `inventory-${selectedCompany.id}.json`), data: inventory });
        return sendJson(response, 200, inventory);
    }
    if (pathname === '/api/companies' && request.method === 'POST') {
        if (!allowed(user, 'admin')) return sendJson(response, 403, { error: 'Somente o admin master pode criar empresas.' });
        const { name, cnpj, phone, email, address } = await body(request);
        if (!name?.trim()) return sendJson(response, 400, { error: 'Informe o nome da empresa.' });
        if ([name, cnpj, phone, email, address].some((field) => field && String(field).length > 200)) return sendJson(response, 400, { error: 'Um dos campos excede o tamanho máximo permitido.' });
        const companies = await readCompanies(); if (companies.some((company) => company.name.toLowerCase() === name.trim().toLowerCase())) return sendJson(response, 409, { error: 'Empresa já cadastrada.' });
        const company = { id: randomUUID(), name: name.trim(), cnpj: cnpj?.trim() || '', phone: phone?.trim() || '', email: email?.trim() || '', address: address?.trim() || '', active: true }; companies.push(company);
        const managerUsername = `gerente_${company.id.slice(0, 6)}`;
        const manager = { id: randomUUID(), name: 'Gerente', username: managerUsername, role: 'manager', active: true, exportReports: false, companyIds: [company.id], mustChangePassword: true, profileImage: '', passwordHash: await hashPassword('gerente') };
        users.push(manager); await writeFile(companiesFile, JSON.stringify(companies, null, 2)); await writeFile(usersFile, JSON.stringify(users, null, 2)); return sendJson(response, 201, { company, manager: { name: manager.name, username: manager.username, temporaryPassword: 'gerente' } });
    }
    const companyInventoryMatch = pathname.match(/^\/api\/companies\/([^/]+)\/inventory$/);
    if (companyInventoryMatch && request.method === 'GET') {
        if (!allowed(user, 'admin')) return sendJson(response, 403, { error: 'Somente o admin master pode baixar dados de outras empresas.' });
        if (!(await readCompanies()).some((company) => company.id === companyInventoryMatch[1])) return sendJson(response, 404, { error: 'Empresa não encontrada.' });
        return sendJson(response, 200, await readCompanyInventory(companyInventoryMatch[1]));
    }
    const companyMatch = pathname.match(/^\/api\/companies\/([^/]+)$/);
    if (companyMatch && request.method === 'DELETE') {
        if (!allowed(user, 'admin')) return sendJson(response, 403, { error: 'Somente o admin master pode remover empresas.' });
        const { password } = await body(request);
        if (!password || !(await verifyPassword(password, user.passwordHash))) return sendJson(response, 401, { error: 'Senha de administrador incorreta.' });
        if (companyMatch[1] === 'default') return sendJson(response, 400, { error: 'A empresa matriz BRSTEC não pode ser removida.' });
        const companies = await readCompanies();
        const company = companies.find((item) => item.id === companyMatch[1]);
        if (!company) return sendJson(response, 404, { error: 'Empresa não encontrada.' });
        companies.splice(companies.indexOf(company), 1);
        users.forEach((item) => { if (Array.isArray(item.companyIds)) item.companyIds = item.companyIds.filter((id) => id !== companyMatch[1]); });
        for (let index = users.length - 1; index >= 0; index -= 1) { const item = users[index]; if (Array.isArray(item.companyIds) && item.companyIds.length === 0) users.splice(index, 1); }
        for (const [token, session] of [...sessions]) if (session.companyId === companyMatch[1]) sessions.delete(token);
        persistSessions();
        await writeFile(companiesFile, JSON.stringify(companies, null, 2));
        await writeFile(usersFile, JSON.stringify(users, null, 2));
        await rm(join(dataDir, `inventory-${companyMatch[1]}.json`), { force: true });
        return sendJson(response, 200, { ok: true, company: { id: company.id, name: company.name } });
    }
    if (pathname === '/api/export' && request.method === 'GET') return user.exportReports ? sendJson(response, 200, { allowed: true }) : sendJson(response, 403, { error: 'Seu usuário não tem permissão para exportar relatórios.' });
    if (pathname === '/api/users' && request.method === 'GET') {
        const isMaster = allowed(user, 'admin');
        if (!isMaster && user.role !== 'manager') return sendJson(response, 403, { error: 'Somente administradores e gerentes podem listar usuários.' });
        const list = isMaster ? users : users.filter((item) => Array.isArray(item.companyIds) && item.companyIds.includes(selectedCompany.id));
        return sendJson(response, 200, { users: list.map(publicUser) });
    }
    if (pathname === '/api/users' && request.method === 'POST') {
        const isMaster = allowed(user, 'admin');
        if (!isMaster && user.role !== 'manager') return sendJson(response, 403, { error: 'Permissão insuficiente.' });
        const { name, username, password, role, companyIds } = await body(request);
        if (!name || !username || !password || password.length < 6 || !roles.includes(role)) return sendJson(response, 400, { error: 'Preencha todos os campos corretamente. A senha deve ter pelo menos 6 caracteres.' });
        if (typeof name !== 'string' || name.trim().length > 80) return sendJson(response, 400, { error: 'O nome deve ter até 80 caracteres.' });
        if (!/^[a-zA-Z0-9_.-]{3,30}$/.test(String(username))) return sendJson(response, 400, { error: 'O usuário deve ter de 3 a 30 caracteres (letras, números, ponto, hífen ou underline).' });
        if (password.length > 128) return sendJson(response, 400, { error: 'A senha deve ter no máximo 128 caracteres.' });
        if (users.some((item) => item.username === username)) return sendJson(response, 409, { error: 'Este usuário já existe.' });
        let linkedCompanies;
        if (isMaster) {
            linkedCompanies = Array.isArray(companyIds) && companyIds.length ? companyIds : ['default'];
            const availableCompanies = await readCompanies();
            if (linkedCompanies.some((companyId) => !availableCompanies.some((company) => company.id === companyId))) return sendJson(response, 400, { error: 'Empresa vinculada não existe.' });
        } else {
            if (role === 'admin') return sendJson(response, 403, { error: 'Somente o admin master pode criar administradores.' });
            linkedCompanies = [selectedCompany.id];
        }
        const created = { id: randomUUID(), name, username, role, active: true, exportReports: false, companyIds: linkedCompanies, profileImage: '', passwordHash: await hashPassword(password) };
        users.push(created); await writeFile(usersFile, JSON.stringify(users, null, 2)); return sendJson(response, 201, { user: publicUser(created) });
    }
    const match = pathname.match(/^\/api\/users\/([^/]+)$/);
    if (match && request.method === 'PATCH') {
        const target = users.find((item) => item.id === match[1]); if (!target) return sendJson(response, 404, { error: 'Usuário não encontrado.' });
        const data = await body(request); if (data.role && !roles.includes(data.role)) return sendJson(response, 400, { error: 'Nível de acesso inválido.' });
        if (data.name !== undefined && (typeof data.name !== 'string' || !data.name.trim() || data.name.trim().length > 80)) return sendJson(response, 400, { error: 'Informe um nome válido com até 80 caracteres.' });
        if (data.profileImage && (typeof data.profileImage !== 'string' || !data.profileImage.startsWith('data:image/'))) return sendJson(response, 400, { error: 'A foto deve ser uma imagem válida.' });
        if (data.profileImage && data.profileImage.length > 500000) return sendJson(response, 413, { error: 'A foto deve ter no máximo 500 KB.' });
        if (data.password && (String(data.password).length < 6 || String(data.password).length > 128)) return sendJson(response, 400, { error: 'A senha deve ter entre 6 e 128 caracteres.' });
        const isMaster = allowed(user, 'admin');
        const isManager = user.role === 'manager';
        if (!isMaster && !isManager && target.id !== user.id) return sendJson(response, 403, { error: 'Permissão insuficiente.' });
        if (!isMaster && !isManager && (data.role !== undefined || data.active !== undefined || data.exportReports !== undefined || data.companyIds !== undefined)) return sendJson(response, 403, { error: 'Somente administradores podem alterar permissões.' });
        if (isManager && target.id !== user.id && !(Array.isArray(target.companyIds) && target.companyIds.includes(selectedCompany.id))) return sendJson(response, 403, { error: 'Este usuário não pertence à sua empresa.' });
        if (isManager && data.role === 'admin') return sendJson(response, 403, { error: 'Somente o admin master define administradores.' });
        if (isManager && data.companyIds !== undefined) return sendJson(response, 403, { error: 'Somente o admin master pode alterar vínculos de empresa.' });
        if (target.id === user.id && data.active === false) return sendJson(response, 400, { error: 'O administrador atual não pode se desativar.' });
        const companyIds = data.companyIds ? (Array.isArray(data.companyIds) ? data.companyIds : [data.companyIds]) : target.companyIds ?? ['default'];
        const availableCompanies = await readCompanies();
        if (user.role === 'admin' && companyIds.some((companyId) => companyId !== '*' && !availableCompanies.some((company) => company.id === companyId))) return sendJson(response, 400, { error: 'Empresa vinculada não existe.' });
        Object.assign(target, { name: data.name ?? target.name, role: data.role ?? target.role, active: data.active ?? target.active, exportReports: data.exportReports ?? target.exportReports ?? false, companyIds, profileImage: data.profileImage ?? target.profileImage ?? '' });
        if (data.password) target.passwordHash = await hashPassword(data.password);
        await writeFile(usersFile, JSON.stringify(users, null, 2)); return sendJson(response, 200, { user: publicUser(target) });
    }
    return sendJson(response, 404, { error: 'Endpoint não encontrado.' });
}

const server = createServer(async (request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname.startsWith('/api/')) return handleApi(request, response, pathname).catch((error) => { console.error(error); sendJson(response, error.statusCode || 500, { error: error.statusCode === 413 ? 'Requisição muito grande.' : error.statusCode === 400 ? 'Requisição inválida.' : 'Erro interno do servidor.' }); });
    const requestedPath = pathname === '/' ? '/index.html' : pathname;
    const isAppScript = requestedPath === '/app.js';
    const filePath = isAppScript ? join(root, '..', 'app.js') : normalize(join(root, requestedPath));
    const relativePath = relative(root, filePath);
    if (!isAppScript && (relativePath.startsWith('..') || isAbsolute(relativePath))) { response.writeHead(403); return response.end('Acesso negado'); }
    try {
        const content = await readFile(filePath);
        const contentType = types[extname(filePath)] || 'application/octet-stream';
        response.writeHead(200, { 'Content-Type': contentType, ...securityHeaders(contentType) });
        response.end(content);
    } catch { response.writeHead(404, securityHeaders('text/plain')); response.end(STATUS_CODES[404]); }
});

const port = process.env.PORT || 3000;
const host = '0.0.0.0';
const localAddresses = Object.values(networkInterfaces()).flat().filter((entry) => entry?.family === 'IPv4' && !entry.internal).map((entry) => `http://${entry.address}:${port}`);
server.listen(port, host, () => {
    console.log(`Estoque Mais disponível em http://localhost:${port}`);
    localAddresses.forEach((address) => console.log(`Acesso na rede local: ${address}`));
});

// ---- Servidor dedicado ao site institucional (rota/porta próprias) ----
const siteTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const siteFiles = new Set(['/site.html', '/site.css', '/site.js']);
const siteServer = createServer(async (request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const requestedPath = pathname === '/' ? '/site.html' : pathname;
    if (!siteFiles.has(requestedPath)) { response.writeHead(404, securityHeaders('text/plain')); return response.end(STATUS_CODES[404]); }
    try {
        const content = await readFile(join(root, requestedPath));
        const contentType = siteTypes[extname(requestedPath)] || 'application/octet-stream';
        response.writeHead(200, { 'Content-Type': contentType, ...securityHeaders(contentType) });
        response.end(content);
    } catch { response.writeHead(404, securityHeaders('text/plain')); response.end(STATUS_CODES[404]); }
});
const sitePort = process.env.SITE_PORT || 4000;
siteServer.listen(sitePort, host, () => {
    console.log(`Site do Estoque Mais disponível em http://localhost:${sitePort}`);
    localAddresses.forEach((address) => console.log(`Site na rede local: ${address.replace(String(port), String(sitePort))}`));
});
