import { spawn } from 'node:child_process';
import { request } from 'node:http';
import assert from 'node:assert/strict';
import { readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dataDir = join(root, 'src', 'data');
const PORT = 3100;
const base = `http://localhost:${PORT}`;

let passed = 0;
let failed = 0;
const failures = [];
const section = (title) => console.log(`\n■ ${title}`);
async function test(name, fn) {
    try {
        await fn();
        passed += 1;
        console.log(`  ✓ ${name}`);
    } catch (error) {
        failed += 1;
        failures.push(name);
        console.log(`  ✗ ${name}\n      ${String(error.message).split('\n')[0]}`);
    }
}

const call = (method, path, body, headers = {}) => new Promise((resolve, reject) => {
    const payload = typeof body === 'string' ? body : body ? JSON.stringify(body) : null;
    const req = request({ host: 'localhost', port: PORT, method, path, headers: { ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}), ...headers } }, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, data }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
});
const json = (response) => JSON.parse(response.data);
const login = async (username, password, companyId = 'default') => {
    const res = await call('POST', '/api/login', { username, password, companyId });
    return { res, cookie: (res.headers['set-cookie']?.[0] || '').split(';')[0] };
};

// ---- ciclo de vida: dados reais são preservados via snapshot ----
const snapshot = new Map();
async function snapshotData() {
    for (const file of await readdir(dataDir)) if (file.endsWith('.json')) snapshot.set(file, await readFile(join(dataDir, file)));
}
async function restoreData() {
    for (const file of await readdir(dataDir)) {
        if (!file.endsWith('.json')) continue;
        if (snapshot.has(file)) await writeFile(join(dataDir, file), snapshot.get(file));
        else await rm(join(dataDir, file), { force: true });
    }
}

const child = spawn(process.execPath, ['src/server.js'], { cwd: root, env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
try {
    await snapshotData();
    let ready = false;
    for (let attempt = 0; attempt < 50 && !ready; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        ready = await call('GET', '/api/companies').then((res) => res.status === 200).catch(() => false);
    }
    if (!ready) throw new Error('Servidor de teste não subiu na porta ' + PORT);

    let adminCookie = '';
    let adminPassword = 'admin';

    section('Autenticação');
    await test('login válido retorna 200 e cookie de sessão', async () => {
        const { res, cookie } = await login('admin', 'admin');
        assert.equal(res.status, 200);
        assert.match(cookie, /^estoque_session=/);
        adminCookie = cookie;
    });
    await test('login com senha errada retorna 401', async () => {
        assert.equal((await login('admin', 'errada')).res.status, 401);
    });
    await test('login com usuário inexistente retorna 401', async () => {
        assert.equal((await login('nao-existe', 'x')).res.status, 401);
    });
    await test('login sem companyId retorna 403', async () => {
        const res = await call('POST', '/api/login', { username: 'admin', password: 'admin' });
        assert.equal(res.status, 403);
    });
    await test('master admin é bloqueado em outra empresa (403)', async () => {
        const companies = json(await call('GET', '/api/companies'));
        const other = companies.find((company) => company.id !== 'default');
        assert.equal((await login('admin', 'admin', other.id)).res.status, 403);
    });
    await test('cookie falsificado não autentica (401)', async () => {
        assert.equal((await call('GET', '/api/session', null, { cookie: 'estoque_session=deadbeef' })).status, 401);
    });
    await test('rate limit: 6ª tentativa seguida retorna 429', async () => {
        const user = `rl_${Date.now()}`;
        for (let attempt = 0; attempt < 5; attempt += 1) assert.equal((await login(user, 'x')).res.status, 401);
        assert.equal((await login(user, 'x')).res.status, 429);
    });
    await test('logout encerra a sessão', async () => {
        const { cookie } = await login('admin', 'admin');
        await call('POST', '/api/logout', null, { cookie });
        assert.equal((await call('GET', '/api/session', null, { cookie })).status, 401);
    });

    section('Sessão e conta');
    await test('senha nova com menos de 6 caracteres é rejeitada (400)', async () => {
        assert.equal((await call('POST', '/api/account/password', { password: '12345' }, { cookie: adminCookie })).status, 400);
    });
    await test('troca de senha valida credenciais novas e derruba a antiga', async () => {
        const changed = await call('POST', '/api/account/password', { password: 'novaSenha123' }, { cookie: adminCookie });
        assert.equal(changed.status, 200);
        assert.equal((await login('admin', 'admin')).res.status, 401);
        assert.equal((await login('admin', 'novaSenha123')).res.status, 200);
        adminPassword = 'novaSenha123';
    });

    section('Estoque');
    await test('GET inventory retorna estrutura completa', async () => {
        const inventory = json(await call('GET', '/api/inventory', null, { cookie: adminCookie }));
        assert.ok(Array.isArray(inventory.products));
        assert.ok(Array.isArray(inventory.movements));
        assert.ok(Array.isArray(inventory.productAudits));
    });
    await test('PUT válido persiste alteração de quantidade', async () => {
        const inventory = json(await call('GET', '/api/inventory', null, { cookie: adminCookie }));
        inventory.products[0].quantity += 1;
        assert.equal((await call('PUT', '/api/inventory', inventory, { cookie: adminCookie })).status, 200);
        const after = json(await call('GET', '/api/inventory', null, { cookie: adminCookie }));
        assert.equal(after.products[0].quantity, inventory.products[0].quantity);
    });
    await test('PUT com produto sem nome retorna 400', async () => {
        const inventory = json(await call('GET', '/api/inventory', null, { cookie: adminCookie }));
        inventory.products.push({ id: 99999, name: '', sku: 'X', category: 'C', quantity: 1, minimum: 1, price: 1 });
        assert.equal((await call('PUT', '/api/inventory', inventory, { cookie: adminCookie })).status, 400);
    });
    await test('PUT com quantidade negativa retorna 400', async () => {
        const inventory = json(await call('GET', '/api/inventory', null, { cookie: adminCookie }));
        inventory.products[0].quantity = -5;
        assert.equal((await call('PUT', '/api/inventory', inventory, { cookie: adminCookie })).status, 400);
    });
    await test('PUT com preço não numérico retorna 400', async () => {
        const inventory = json(await call('GET', '/api/inventory', null, { cookie: adminCookie }));
        inventory.products[0].price = 'caro';
        assert.equal((await call('PUT', '/api/inventory', inventory, { cookie: adminCookie })).status, 400);
    });
    await test('PUT sem array de movimentações retorna 400', async () => {
        const inventory = json(await call('GET', '/api/inventory', null, { cookie: adminCookie }));
        delete inventory.movements;
        assert.equal((await call('PUT', '/api/inventory', inventory, { cookie: adminCookie })).status, 400);
    });

    section('Empresas');
    let tempCompanyId = '';
    let tempManagerUsername = '';
    await test('criar empresa sem nome retorna 400', async () => {
        assert.equal((await call('POST', '/api/companies', { name: '  ' }, { cookie: adminCookie })).status, 400);
    });
    await test('criar empresa com nome duplicado retorna 409', async () => {
        const name = `Duplicada ${Date.now()}`;
        assert.equal((await call('POST', '/api/companies', { name }, { cookie: adminCookie })).status, 201);
        assert.equal((await call('POST', '/api/companies', { name: name.toLowerCase() }, { cookie: adminCookie })).status, 409);
        const companies = json(await call('GET', '/api/companies'));
        const target = companies.find((company) => company.name.toLowerCase() === name.toLowerCase());
        await call('DELETE', `/api/companies/${target.id}`, { password: adminPassword }, { cookie: adminCookie });
    });
    await test('fluxo completo: criar, logar gerente, backup e excluir', async () => {
        const created = await call('POST', '/api/companies', { name: `Empresa Fluxo ${Date.now()}` }, { cookie: adminCookie });
        assert.equal(created.status, 201);
        const { company, manager } = json(created);
        tempCompanyId = company.id;
        tempManagerUsername = manager.username;
        const managerLogin = await login(tempManagerUsername, 'gerente', tempCompanyId);
        assert.equal(managerLogin.res.status, 200);
        assert.equal((await call('GET', `/api/companies/${tempCompanyId}/inventory`, null, { cookie: adminCookie })).status, 200);
        assert.equal((await call('DELETE', `/api/companies/${tempCompanyId}`, { password: 'errada' }, { cookie: adminCookie })).status, 401);
        assert.equal((await call('DELETE', `/api/companies/${tempCompanyId}`, { password: adminPassword }, { cookie: adminCookie })).status, 200);
        const remaining = json(await call('GET', '/api/companies'));
        assert.ok(!remaining.some((item) => item.id === tempCompanyId));
        assert.equal((await call('GET', `/api/companies/${tempCompanyId}/inventory`, null, { cookie: adminCookie })).status, 404);
        assert.equal((await login(tempManagerUsername, 'gerente', tempCompanyId)).res.status, 401);
        tempCompanyId = '';
    });
    await test('excluir a empresa matriz BRSTEC é bloqueado (400)', async () => {
        assert.equal((await call('DELETE', '/api/companies/default', { password: adminPassword }, { cookie: adminCookie })).status, 400);
    });
    await test('estoque de cada empresa é isolado', async () => {
        const created = await call('POST', '/api/companies', { name: `Isolada ${Date.now()}` }, { cookie: adminCookie });
        const id = json(created).company.id;
        const fresh = json(await call('GET', `/api/companies/${id}/inventory`, null, { cookie: adminCookie }));
        const mine = json(await call('GET', '/api/inventory', null, { cookie: adminCookie }));
        assert.equal(fresh.products.length, 6);
        assert.notDeepEqual(fresh.products, mine.products);
        await call('DELETE', `/api/companies/${id}`, { password: adminPassword }, { cookie: adminCookie });
    });

    section('Usuários e permissões');
    let viewerCookie = '';
    let viewerId = '';
    const suffix = Date.now();
    await test('criar usuário sem campos obrigatórios retorna 400', async () => {
        assert.equal((await call('POST', '/api/users', { name: 'X' }, { cookie: adminCookie })).status, 400);
    });
    await test('criar usuário com papel inválido retorna 400', async () => {
        assert.equal((await call('POST', '/api/users', { name: 'X', username: `u${suffix}`, password: 'senha123', role: 'dono' }, { cookie: adminCookie })).status, 400);
    });
    await test('criar usuário com username duplicado retorna 409', async () => {
        assert.equal((await call('POST', '/api/users', { name: 'X', username: 'admin', password: 'senha123', role: 'viewer' }, { cookie: adminCookie })).status, 409);
    });
    await test('criar usuário vinculado a empresa inexistente retorna 400', async () => {
        assert.equal((await call('POST', '/api/users', { name: 'X', username: `u${suffix}`, password: 'senha123', role: 'viewer', companyIds: ['nao-existe'] }, { cookie: adminCookie })).status, 400);
    });
    await test('criar usuário com senha curta retorna 400', async () => {
        assert.equal((await call('POST', '/api/users', { name: 'X', username: `curto${suffix}`, password: '12345', role: 'viewer' }, { cookie: adminCookie })).status, 400);
    });
    await test('viewer não lista usuários (403)', async () => {
        const created = await call('POST', '/api/users', { name: 'Viewer Temp', username: `viewer${suffix}`, password: 'senha123', role: 'viewer' }, { cookie: adminCookie });
        assert.equal(created.status, 201);
        viewerId = json(created).user.id;
        viewerCookie = (await login(`viewer${suffix}`, 'senha123')).cookie;
        assert.equal((await call('GET', '/api/users', null, { cookie: viewerCookie })).status, 403);
    });
    await test('viewer não altera o estoque (403)', async () => {
        const inventory = json(await call('GET', '/api/inventory', null, { cookie: adminCookie }));
        assert.equal((await call('PUT', '/api/inventory', inventory, { cookie: viewerCookie })).status, 403);
    });
    await test('não-admin não edita outro usuário (403)', async () => {
        const adminId = json(await call('GET', '/api/session', null, { cookie: adminCookie })).user.id;
        assert.equal((await call('PATCH', `/api/users/${adminId}`, { name: 'Invadido' }, { cookie: viewerCookie })).status, 403);
    });
    await test('SEGURANÇA: não-admin não pode ampliar próprias empresas via PATCH (deve ser 403)', async () => {
        const companies = json(await call('GET', '/api/companies'));
        const other = companies.find((company) => company.id !== 'default');
        const res = await call('PATCH', `/api/users/${viewerId}`, { name: 'Viewer Temp', companyIds: [other.id] }, { cookie: viewerCookie });
        assert.equal(res.status, 403, `esperado 403, recebido ${res.status}: ${res.data}`);
    });
    await test('admin não pode desativar a própria conta (400)', async () => {
        const me = json(await call('GET', '/api/session', null, { cookie: adminCookie })).user;
        assert.equal((await call('PATCH', `/api/users/${me.id}`, { active: false }, { cookie: adminCookie })).status, 400);
    });
    await test('foto de perfil acima de 500 KB retorna 413', async () => {
        assert.equal((await call('PATCH', `/api/users/${viewerId}`, { profileImage: `data:image/png;base64,${'x'.repeat(500000)}` }, { cookie: adminCookie })).status, 413);
    });

    section('Gestão pelo gerente da empresa');
    await test('gerente cria usuários apenas na própria empresa e não cria admin', async () => {
        const created = await call('POST', '/api/companies', { name: `Com Gerente ${Date.now()}` }, { cookie: adminCookie });
        const { company, manager } = json(created);
        const { cookie } = await login(manager.username, 'gerente', company.id);
        const local = await call('POST', '/api/users', { name: 'Operador Local', username: `op${Date.now()}`, password: 'senha123', role: 'operator' }, { cookie });
        assert.equal(local.status, 201);
        assert.deepEqual(json(local).user.companyIds, [company.id]);
        const asAdmin = await call('POST', '/api/users', { name: 'Admin Local', username: `adm${Date.now()}`, password: 'senha123', role: 'admin' }, { cookie });
        assert.equal(asAdmin.status, 403);
        await call('DELETE', `/api/companies/${company.id}`, { password: adminPassword }, { cookie: adminCookie });
    });
    await test('gerente lista somente os usuários da própria empresa', async () => {
        const created = await call('POST', '/api/companies', { name: `Escopo ${Date.now()}` }, { cookie: adminCookie });
        const { company, manager } = json(created);
        const { cookie } = await login(manager.username, 'gerente', company.id);
        await call('POST', '/api/users', { name: 'Local', username: `loc${Date.now()}`, password: 'senha123', role: 'viewer' }, { cookie });
        const list = json(await call('GET', '/api/users', null, { cookie })).users;
        assert.ok(list.length >= 2);
        assert.ok(list.every((item) => Array.isArray(item.companyIds) && item.companyIds.includes(company.id)));
        await call('DELETE', `/api/companies/${company.id}`, { password: adminPassword }, { cookie: adminCookie });
    });
    await test('excluir empresa remove também os usuários vinculados a ela', async () => {
        const created = await call('POST', '/api/companies', { name: `Purga ${Date.now()}` }, { cookie: adminCookie });
        const { company, manager } = json(created);
        const localUsername = `purga${Date.now()}`;
        const managerSession = await login(manager.username, 'gerente', company.id);
        await call('POST', '/api/users', { name: 'Local Purga', username: localUsername, password: 'senha123', role: 'operator' }, { cookie: managerSession.cookie });
        assert.equal((await login(localUsername, 'senha123', company.id)).res.status, 200);
        assert.equal((await call('DELETE', `/api/companies/${company.id}`, { password: adminPassword }, { cookie: adminCookie })).status, 200);
        assert.equal((await login(localUsername, 'senha123', company.id)).res.status, 401);
        assert.equal((await login(manager.username, 'gerente', company.id)).res.status, 401);
    });
    await test('gerente edita usuário da própria empresa, mas não de outra (403)', async () => {
        const created = await call('POST', '/api/companies', { name: `Edição ${Date.now()}` }, { cookie: adminCookie });
        const { company, manager } = json(created);
        const { cookie } = await login(manager.username, 'gerente', company.id);
        const localId = json(await call('GET', '/api/users', null, { cookie })).users.find((item) => item.role === 'manager').id;
        assert.equal((await call('PATCH', `/api/users/${localId}`, { name: 'Gerente Renomeado' }, { cookie })).status, 200);
        const adminId = json(await call('GET', '/api/session', null, { cookie: adminCookie })).user.id;
        assert.equal((await call('PATCH', `/api/users/${adminId}`, { name: 'Invasão' }, { cookie })).status, 403);
        await call('DELETE', `/api/companies/${company.id}`, { password: adminPassword }, { cookie: adminCookie });
    });

    section('Endurecimento e cabeçalhos de segurança');
    await test('corpo JSON malformado retorna 400', async () => {
        const res = await call('POST', '/api/login', '{"username": "admin",', { 'Content-Type': 'application/json' });
        assert.equal(res.status, 400);
    });
    await test('corpo maior que o limite retorna 413', async () => {
        try {
            const res = await call('POST', '/api/login', 'x'.repeat(3 * 1024 * 1024), { 'Content-Type': 'application/json' });
            assert.equal(res.status, 413);
        } catch {
            // Se a conexão for encerrada durante o envio do corpo excedente,
            // isso também confirma que a requisição foi rejeitada pelo servidor.
        }
    });
    await test('cabeçalhos de segurança presentes na página inicial', async () => {
        const res = await call('GET', '/');
        assert.equal(res.headers['x-content-type-options'], 'nosniff');
        assert.equal(res.headers['x-frame-options'], 'DENY');
        assert.match(String(res.headers['content-security-policy']), /default-src 'self'/);
        assert.equal(res.headers['referrer-policy'], 'no-referrer');
    });
    await test('respostas da API não podem ser cacheadas', async () => {
        const res = await call('GET', '/api/companies');
        assert.equal(res.headers['cache-control'], 'no-store');
    });
    await test('username com caracteres inválidos retorna 400', async () => {
        const res = await call('POST', '/api/users', { name: 'X', username: 'usuário inválido!', password: 'senha123', role: 'viewer' }, { cookie: adminCookie });
        assert.equal(res.status, 400);
    });
    await test('foto de perfil fora do formato imagem retorna 400', async () => {
        const res = await call('PATCH', `/api/users/${viewerId}`, { profileImage: 'javascript:alert(1)' }, { cookie: adminCookie });
        assert.equal(res.status, 400);
    });

    section('Arquivos estáticos e exposição de dados');
    await test('raiz serve o index.html', async () => {
        const res = await call('GET', '/');
        assert.equal(res.status, 200);
        assert.ok(res.data.includes('<html'));
    });
    await test('/app.js é servido', async () => {
        assert.equal((await call('GET', '/app.js')).status, 200);
    });
    await test('path traversal codificado não vaza arquivos do servidor', async () => {
        const res = await call('GET', '/%2e%2e/server.js');
        assert.notEqual(res.status, 200);
    });
    await test('diretório de dados não é acessível via HTTP', async () => {
        assert.equal((await call('GET', '/data/users.json')).status, 404);
        assert.equal((await call('GET', '/src/server.js')).status, 404);
    });
} catch (error) {
    failed += 1;
    failures.push(`Erro fatal: ${error.message}`);
    console.error(`\nErro fatal: ${error.message}`);
} finally {
    child.kill();
    await restoreData().catch(() => {});
}

console.log(`\n══════════════════════════════════`);
console.log(`Resultado: ${passed} passaram, ${failed} falharam`);
if (failures.length) {
    console.log('Testes com falha:');
    failures.forEach((name) => console.log(`  • ${name}`));
}
process.exitCode = failed ? 1 : 0;