import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const child = spawn(process.execPath, ['src/server.js'], { cwd: root, stdio: 'ignore' });
const call = (method, path, body, headers = {}) => new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = request({ host: 'localhost', port: 3000, method, path, headers: { ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}), ...headers } }, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, data }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
});

try {
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const companies = await call('GET', '/api/companies');
    console.log(`GET /api/companies → ${companies.status} (${JSON.parse(companies.data).length} empresa(s))`);
    const login = await call('POST', '/api/login', { username: 'admin', password: 'admin', companyId: 'default' });
    const cookie = (login.headers['set-cookie']?.[0] || '').split(';')[0];
    console.log(`POST /api/login → ${login.status} (${cookie ? 'cookie de sessão recebido' : 'sem cookie'})`);
    const session = await call('GET', '/api/session', null, { cookie });
    console.log(`GET /api/session → ${session.status} (usuário: ${JSON.parse(session.data).user?.username})`);
    const otherCompany = JSON.parse(companies.data).find((company) => company.id !== 'default');
    const blocked = await call('POST', '/api/login', { username: 'admin', password: 'admin', companyId: otherCompany.id });
    console.log(`POST /api/login admin em outra empresa → ${blocked.status} (esperado 403)`);
    const created = await call('POST', '/api/companies', { name: `Empresa Temporária ${Date.now()}` }, { cookie });
    console.log(`POST /api/companies → ${created.status} (esperado 201)`);
    const tempId = JSON.parse(created.data).company.id;
    const wrongPassword = await call('DELETE', `/api/companies/${tempId}`, { password: 'senha-errada' }, { cookie });
    console.log(`DELETE com senha errada → ${wrongPassword.status} (esperado 401)`);
    const backup = await call('GET', `/api/companies/${tempId}/inventory`, null, { cookie });
    console.log(`GET backup do estoque da empresa → ${backup.status} (esperado 200)`);
    const removed = await call('DELETE', `/api/companies/${tempId}`, { password: 'admin' }, { cookie });
    console.log(`DELETE empresa temporária → ${removed.status} (esperado 200)`);
    const badPut = await call('PUT', '/api/inventory', { products: [{ name: '' }], movements: [], productAudits: [] }, { cookie });
    console.log(`PUT /api/inventory inválido → ${badPut.status} (esperado 400)`);
    const inventory = await call('GET', '/api/inventory', null, { cookie });
    console.log(`GET /api/inventory → ${inventory.status} (${JSON.parse(inventory.data).products.length} produto(s))`);
    const unauthorized = await call('GET', '/api/users');
    console.log(`GET /api/users sem sessão → ${unauthorized.status} (esperado 401)`);
    const legacySite = await call('GET', '/site');
    console.log(`GET :3000/site → ${legacySite.status} (esperado 404 — site em rota/porta próprias)`);
    const siteCall = (path) => new Promise((resolve, reject) => {
        const req = request({ host: 'localhost', port: 4000, method: 'GET', path }, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => resolve({ status: res.statusCode, data }));
        });
        req.on('error', reject);
        req.end();
    });
    try {
        const siteHome = await siteCall('/');
        console.log(`GET :4000/ → ${siteHome.status} (site institucional)`);
        console.log(`Contém seção Ajuda: ${siteHome.data.includes('Como usar o Estoque Mais')}`);
    } catch (error) {
        console.log(`Aviso: site na porta 4000 indisponível (${error.message})`);
    }
    console.log('Smoke test concluído com sucesso.');
} catch (error) {
    console.error('Falha no smoke test:', error.message);
    process.exitCode = 1;
} finally {
    child.kill();
}