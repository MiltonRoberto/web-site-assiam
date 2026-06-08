import './index.js';

await new Promise((r) => setTimeout(r, 1500));
const BASE = 'http://localhost:3333';
const post = (p, b) =>
  fetch(BASE + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(b),
  }).then((r) => r.json());

const out = [];
const log = (...a) => out.push(a.join(' '));

log('\n--- validar-cupom ---');
log('milton roberto    :', JSON.stringify(await post('/api/validar-cupom', { codigo: 'milton roberto' })));
log('  MILTON  ROBERTO :', JSON.stringify(await post('/api/validar-cupom', { codigo: '  MILTON   ROBERTO  ' })));
log('Gabriela Minuzzi  :', JSON.stringify(await post('/api/validar-cupom', { codigo: 'Gabriela Minuzzi' })));
log('inexistente       :', JSON.stringify(await post('/api/validar-cupom', { codigo: 'fulano da silva' })));

log('\n--- uso unico: usar e revalidar ---');
log('usar amanda roos  :', JSON.stringify(await post('/api/usar-cupom', { codigo: 'Amanda Roos', orderId: 'X1' })));
log('revalidar amanda  :', JSON.stringify(await post('/api/validar-cupom', { codigo: 'amanda roos' })));

log('\n--- ilimitado: usar e revalidar (continua valido) ---');
log('usar gabriela     :', JSON.stringify(await post('/api/usar-cupom', { codigo: 'Gabriela Minuzzi', orderId: 'X2' })));
log('revalidar gabriela:', JSON.stringify(await post('/api/validar-cupom', { codigo: 'Gabriela Minuzzi' })));

log('\n--- checkout COM cupom (caneca 3500 -> custo 2800) ---');
const co1 = await post('/api/checkout', { customer: { name: 'Teste Cupom', phone: '5599' }, selection: { caneca: { quantity: 1 } }, cupom: 'Marcelo Telles' });
const ped1 = await fetch(BASE + '/api/pedido/' + encodeURIComponent(co1.orderId)).then((r) => r.json());
log('COM cupom -> totalCents:', ped1.totalCents, '| unit:', ped1.items?.[0]?.unitPriceCents);

log('\n--- checkout SEM cupom (caneca 3500) ---');
const co2 = await post('/api/checkout', { customer: { name: 'Teste Sem', phone: '5599' }, selection: { caneca: { quantity: 1 } } });
const ped2 = await fetch(BASE + '/api/pedido/' + encodeURIComponent(co2.orderId)).then((r) => r.json());
log('SEM cupom -> totalCents:', ped2.totalCents, '| unit:', ped2.items?.[0]?.unitPriceCents);

console.log('\n===RESULTADO===\n' + out.join('\n') + '\n===FIM===');
process.exit(0);
