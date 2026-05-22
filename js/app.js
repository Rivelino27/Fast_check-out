'use strict';
// ── Firebase init ──────────────────────────────────────────────────────────
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
const fns = firebase.functions();

// ── State ──────────────────────────────────────────────────────────────────
const state = {
  user: null,
  isAdmin: false,
  foundRoom: null,
  pendingItems: [],
  currentPaymentId: null,
  allCheckouts: [],
  pixUnsubscribe: null,
  roomsUnsubscribe: null,
  notifUnsubscribe: null,
  checkoutsUnsubscribe: null,
};

// ── Utils ──────────────────────────────────────────────────────────────────
const R$ = n => 'R$ ' + Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = ts => {
  if (!ts) return '—';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleString('pt-BR');
};
const parseYesNo = v => {
  if (v == null) return false;
  return ['sim','s','yes','y','true','1'].includes(String(v).toLowerCase().trim());
};
const parseBRL = v => {
  if (v == null || v === '') return 0;
  return Number(String(v).replace(',', '.')) || 0;
};
const qs = sel => document.querySelector(sel);
const qsa = sel => document.querySelectorAll(sel);
const SV = firebase.firestore.FieldValue.serverTimestamp;

// ── Toast ──────────────────────────────────────────────────────────────────
function toast(msg, type = 'info', ms = 4500) {
  const icons = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = `<span>${icons[type] || ''}</span><span>${msg}</span>`;
  qs('#toast-container').appendChild(el);
  setTimeout(() => el.remove(), ms);
}

// ── Views & tabs ───────────────────────────────────────────────────────────
function showView(id) {
  qsa('.view').forEach(v => v.classList.remove('active'));
  const t = qs(`#${id}`);
  if (t) t.classList.add('active');
}
function showTab(id) {
  qsa('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === id));
  qsa('.tab-content').forEach(c => c.classList.toggle('active', c.id === `tab-${id}`));
}

// ── Auth ───────────────────────────────────────────────────────────────────
auth.onAuthStateChanged(async user => {
  state.user = user;
  if (user) {
    const adminDoc = await db.collection('admins').doc(user.uid).get().catch(() => null);
    state.isAdmin = !!(adminDoc && adminDoc.exists);
    if (state.isAdmin) {
      qs('#btn-admin-login').style.display = 'none';
      qs('#btn-admin-logout').style.display = '';
      qs('#btn-notifications').style.display = '';
      showView('admin-dashboard-view');
      startAdminSubs();
    } else {
      toast('Acesso negado. Usuário não é administrador.', 'error');
      auth.signOut();
    }
  } else {
    state.isAdmin = false;
    qs('#btn-admin-login').style.display = '';
    qs('#btn-admin-logout').style.display = 'none';
    qs('#btn-notifications').style.display = 'none';
    stopAdminSubs();
  }
});

async function login() {
  const email = qs('#admin-email').value.trim();
  const pass = qs('#admin-password').value;
  if (!email || !pass) { toast('Preencha e-mail e senha.', 'warning'); return; }
  const btn = qs('#btn-login');
  btn.textContent = 'Entrando…';
  btn.disabled = true;
  try {
    await auth.signInWithEmailAndPassword(email, pass);
  } catch (err) {
    toast('Erro: ' + (err.message || 'Credenciais inválidas.'), 'error');
    btn.textContent = 'Entrar';
    btn.disabled = false;
  }
}

async function logout() {
  await auth.signOut();
  showView('guest-view');
  toast('Sessão encerrada.', 'info');
}

// ── Guest — Search ─────────────────────────────────────────────────────────
async function searchGuest() {
  const name = qs('#guest-name').value.trim();
  const roomNum = qs('#guest-room').value.trim();
  if (!name || !roomNum) { toast('Preencha nome e número do quarto.', 'warning'); return; }

  const btn = qs('#btn-search-guest');
  btn.textContent = 'Buscando…';
  btn.disabled = true;

  try {
    let snap;
    try {
      snap = await db.collection('rooms')
        .where('roomNumber', '==', roomNum)
        .where('status', '==', 'active')
        .get();
    } catch {
      // Fallback sem índice composto
      snap = await db.collection('rooms').where('roomNumber', '==', roomNum).get();
    }

    const matched = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(r => r.status === 'active' && r.guestName.toLowerCase().includes(name.toLowerCase()));

    if (matched.length === 0) {
      toast('Quarto não encontrado ou check-out já realizado.', 'warning');
      return;
    }

    state.foundRoom = matched[0];
    state.pendingItems = [];
    renderGuestBalance(state.foundRoom);
  } catch (err) {
    toast('Erro ao buscar quarto: ' + err.message, 'error');
  } finally {
    btn.textContent = 'Consultar';
    btn.disabled = false;
  }
}

function renderGuestBalance(room) {
  qs('#display-room-number').textContent = room.roomNumber;
  qs('#display-guest-name').textContent = room.guestName;
  qs('#display-rsv').textContent = 'RSV: ' + (room.rsv || '—');

  const bal = room.balance || 0;
  const balEl = qs('#display-balance');
  balEl.textContent = R$(bal);
  balEl.className = 'balance-amount ' + (bal > 0 ? 'neon-pink' : 'neon-green');

  qs('#guest-balance-view').style.display = '';
  refreshGuestUI(bal);
}

function refreshGuestUI(balance) {
  const itemsTotal = state.pendingItems.reduce((s, i) => s + i.price, 0);
  const grandTotal = balance + itemsTotal;

  const itemsListEl = qs('#items-list');
  itemsListEl.innerHTML = state.pendingItems.map(i =>
    `<div class="item-row"><span>${i.name}</span><span>${R$(i.price)}</span></div>`
  ).join('');

  qs('#add-items-section').style.display = balance === 0 && itemsTotal === 0 ? '' : 'none';

  if (grandTotal > 0) {
    qs('#payment-section').style.display = '';
    qs('#payment-total-amount').textContent = R$(grandTotal);
    qs('#checkout-section').style.display = 'none';
  } else {
    qs('#payment-section').style.display = 'none';
    qs('#checkout-section').style.display = '';
  }
}

function addItem(name, price) {
  state.pendingItems.push({ name, price: parseFloat(price) });
  refreshGuestUI(state.foundRoom.balance || 0);
}

// ── Guest — PIX ────────────────────────────────────────────────────────────
async function startPixPayment() {
  const bal = state.foundRoom.balance || 0;
  const itemsTotal = state.pendingItems.reduce((s, i) => s + i.price, 0);
  const total = +(bal + itemsTotal).toFixed(2);
  if (total <= 0) { toast('Saldo zerado. Faça o check-out.', 'info'); return; }

  qs('#pix-amount-display').textContent = R$(total);
  qs('#pix-loading').style.display = '';
  qs('#pix-qr-content').style.display = 'none';
  qs('#pix-success').style.display = 'none';
  qs('#pix-modal').style.display = 'flex';

  try {
    const createPix = fns.httpsCallable('createPixPayment');
    const { data } = await createPix({
      amount: total,
      roomId: state.foundRoom.id,
      guestName: state.foundRoom.guestName,
      roomNumber: state.foundRoom.roomNumber,
      items: state.pendingItems,
    });

    state.currentPaymentId = data.paymentId;
    qs('#pix-loading').style.display = 'none';
    qs('#pix-qr-content').style.display = '';

    // Render QR code
    const canvas = qs('#pix-qr-canvas');
    if (data.pixCodeBase64) {
      canvas.outerHTML = `<img id="pix-qr-canvas" src="data:image/png;base64,${data.pixCodeBase64}"
        style="max-width:220px;border-radius:12px;border:3px solid rgba(0,245,255,.3);padding:8px;background:#fff">`;
    } else if (data.pixCode && typeof QRCode !== 'undefined') {
      QRCode.toCanvas(qs('#pix-qr-canvas'), data.pixCode, { width: 220, margin: 1, color: { dark: '#000', light: '#fff' } });
    }

    qs('#pix-code-text').textContent = data.pixCode || '';

    // Listen for payment approval in real-time
    if (state.pixUnsubscribe) state.pixUnsubscribe();
    state.pixUnsubscribe = db.collection('payments').doc(data.paymentId)
      .onSnapshot(doc => {
        if (doc.data()?.status === 'approved') onPaymentApproved();
      });

  } catch (err) {
    qs('#pix-modal').style.display = 'none';
    toast('Erro ao gerar PIX: ' + (err.message || 'Tente novamente.'), 'error');
    console.error(err);
  }
}

function onPaymentApproved() {
  if (state.pixUnsubscribe) { state.pixUnsubscribe(); state.pixUnsubscribe = null; }
  qs('#pix-loading').style.display = 'none';
  qs('#pix-qr-content').style.display = 'none';
  qs('#pix-success').style.display = '';
  if (state.foundRoom) {
    state.foundRoom.balance = 0;
    state.pendingItems = [];
    renderGuestBalance(state.foundRoom);
  }
  toast('Pagamento PIX confirmado! Você pode fazer o check-out.', 'success', 7000);
}

// ── Guest — Cartão / Google Pay ────────────────────────────────────────────
async function startCardPayment() {
  const bal = state.foundRoom.balance || 0;
  const itemsTotal = state.pendingItems.reduce((s, i) => s + i.price, 0);
  const total = +(bal + itemsTotal).toFixed(2);
  if (total <= 0) { toast('Saldo zerado. Faça o check-out.', 'info'); return; }

  const btn = qs('#btn-pay-card');
  btn.textContent = 'Aguarde…';
  btn.disabled = true;

  try {
    const createPref = fns.httpsCallable('createCardPreference');
    const { data } = await createPref({
      amount: total,
      roomId: state.foundRoom.id,
      guestName: state.foundRoom.guestName,
      roomNumber: state.foundRoom.roomNumber,
      items: state.pendingItems,
    });
    window.location.href = data.initPoint;
  } catch (err) {
    toast('Erro ao iniciar pagamento: ' + err.message, 'error');
    btn.textContent = '💳 Cartão / Google Pay';
    btn.disabled = false;
  }
}

// ── Guest — Checkout ───────────────────────────────────────────────────────
function openCheckoutModal() {
  qs('#checkout-room-display').textContent = state.foundRoom.roomNumber;
  qs('#checkout-guest-display').textContent = state.foundRoom.guestName;
  qs('#checkout-modal').style.display = 'flex';
}

async function confirmCheckout() {
  const room = state.foundRoom;
  const btn = qs('#btn-confirm-checkout');
  btn.textContent = 'Processando…';
  btn.disabled = true;

  try {
    const batch = db.batch();
    const now = SV();

    batch.update(db.collection('rooms').doc(room.id), { status: 'checked-out', checkoutTime: now, updatedAt: now });

    const coRef = db.collection('checkouts').doc();
    batch.set(coRef, { roomId: room.id, rsv: room.rsv || '', roomNumber: room.roomNumber, guestName: room.guestName, finalBalance: room.balance || 0, checkoutTime: now, checkedOutBy: 'guest', adminUid: null });

    const nRef = db.collection('notifications').doc();
    batch.set(nRef, { type: 'checkout', message: `🏨 Check-out realizado — Quarto ${room.roomNumber} — ${room.guestName}`, roomNumber: room.roomNumber, roomId: room.id, amount: null, method: null, read: false, createdAt: now });

    await batch.commit();

    qs('#checkout-modal').style.display = 'none';
    state.foundRoom = null;
    state.pendingItems = [];
    showCheckoutSuccess(room);
  } catch (err) {
    toast('Erro ao fazer check-out: ' + err.message, 'error');
    btn.textContent = '✅ Confirmar Check-Out';
    btn.disabled = false;
  }
}

function showCheckoutSuccess(room) {
  const gv = qs('#guest-view');
  gv.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:60px 20px;text-align:center">
      <div style="font-size:5rem;margin-bottom:20px">🏨✅</div>
      <h2 style="font-family:Orbitron,monospace;font-size:2rem;color:var(--green);text-shadow:0 0 20px var(--green);margin-bottom:14px;letter-spacing:3px">CHECK-OUT REALIZADO!</h2>
      <p style="color:var(--text-dim);font-size:1.1rem;margin-bottom:6px">Quarto <strong style="color:var(--cyan)">${room.roomNumber}</strong> — ${room.guestName}</p>
      <p style="color:var(--text-dim);margin-bottom:32px">Obrigado pela sua estadia. Até logo!</p>
      <button class="btn-primary" style="max-width:280px" onclick="location.reload()">Novo Check-Out</button>
    </div>`;
}

// ── Admin — Subscriptions ──────────────────────────────────────────────────
function startAdminSubs() {
  subscribeRooms();
  subscribeCheckouts();
  subscribeNotifications();
}
function stopAdminSubs() {
  [state.roomsUnsubscribe, state.checkoutsUnsubscribe, state.notifUnsubscribe].forEach(fn => fn && fn());
  state.roomsUnsubscribe = state.checkoutsUnsubscribe = state.notifUnsubscribe = null;
}

// ── Admin — Rooms ──────────────────────────────────────────────────────────
function subscribeRooms() {
  if (state.roomsUnsubscribe) state.roomsUnsubscribe();
  state.roomsUnsubscribe = db.collection('rooms').orderBy('roomNumber')
    .onSnapshot(snap => renderRoomsGrid(snap.docs.map(d => ({ id: d.id, ...d.data() }))), console.error);
}

function renderRoomsGrid(rooms) {
  const grid = qs('#rooms-grid');
  if (!rooms.length) {
    grid.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🏨</div><p>Nenhum quarto carregado. Use a aba <strong>Upload</strong> para importar reservas.</p></div>';
    return;
  }

  // Stats header
  const active = rooms.filter(r => r.status === 'active').length;
  const couted = rooms.filter(r => r.status === 'checked-out').length;
  const withBal = rooms.filter(r => r.status === 'active' && (r.balance || 0) > 0).length;

  const stats = `
    <div style="grid-column:1/-1;display:flex;gap:12px;flex-wrap:wrap;margin-bottom:6px">
      <div class="glass" style="padding:10px 18px;font-size:.85rem;display:flex;gap:8px;align-items:center">
        <span class="neon-cyan" style="font-weight:700">${active}</span><span style="color:var(--text-dim)">ativos</span>
      </div>
      <div class="glass" style="padding:10px 18px;font-size:.85rem;display:flex;gap:8px;align-items:center">
        <span style="color:var(--orange);font-weight:700">${withBal}</span><span style="color:var(--text-dim)">com saldo</span>
      </div>
      <div class="glass" style="padding:10px 18px;font-size:.85rem;display:flex;gap:8px;align-items:center">
        <span class="neon-green" style="font-weight:700">${couted}</span><span style="color:var(--text-dim)">check-out</span>
      </div>
    </div>`;

  grid.innerHTML = stats + rooms.map(r => {
    const bal = r.balance || 0;
    const isOut = r.status === 'checked-out';
    const cardClass = isOut ? 'checked-out' : (bal > 0 ? 'has-balance' : 'no-balance');
    const canCheckout = !isOut && bal === 0;
    const balLabel = isOut ? '<span class="neon-green">✅ Saída</span>' : `<span style="color:${bal > 0 ? 'var(--orange)' : 'var(--green)'}">${R$(bal)}</span>`;
    return `<div class="room-card ${cardClass}">
      <div class="room-card-num neon-cyan">${r.roomNumber}</div>
      <div class="room-card-name">${r.guestName}</div>
      <div class="room-card-rsv">RSV: ${r.rsv || '—'}</div>
      <div class="room-card-balance">${balLabel}</div>
      <div class="room-card-flags">
        ${r.debit ? '<span class="flag flag-debit">Débito</span>' : ''}
        ${r.invoice ? '<span class="flag flag-invoice">Fatura</span>' : ''}
      </div>
      <div class="room-card-actions">
        <button class="btn-admin-checkout" data-id="${r.id}" ${!canCheckout ? 'disabled' : ''}>
          ${isOut ? '✅ Feito' : (bal > 0 ? '⚠ Saldo pend.' : 'Check-Out')}
        </button>
      </div>
    </div>`;
  }).join('');

  grid.querySelectorAll('.btn-admin-checkout:not([disabled])').forEach(btn =>
    btn.addEventListener('click', () => adminCheckout(btn.dataset.id))
  );
}

async function adminCheckout(roomId) {
  if (!confirm('Confirmar check-out deste quarto?')) return;
  try {
    const fn = fns.httpsCallable('adminCheckoutRoom');
    await fn({ roomId });
    toast('Check-out realizado pelo admin!', 'success');
  } catch (err) {
    toast('Erro: ' + err.message, 'error');
  }
}

// ── Admin — Checkouts ──────────────────────────────────────────────────────
function subscribeCheckouts() {
  if (state.checkoutsUnsubscribe) state.checkoutsUnsubscribe();
  state.checkoutsUnsubscribe = db.collection('checkouts').orderBy('checkoutTime', 'desc')
    .onSnapshot(snap => {
      state.allCheckouts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderCheckouts(state.allCheckouts);
    }, console.error);
}

function renderCheckouts(checkouts) {
  const roomF = (qs('#filter-room')?.value || '').toLowerCase();
  const dateF = qs('#filter-date')?.value || '';

  let list = checkouts;
  if (roomF) list = list.filter(c => c.roomNumber.toLowerCase().includes(roomF));
  if (dateF) {
    const d = new Date(dateF);
    list = list.filter(c => {
      if (!c.checkoutTime) return false;
      return (c.checkoutTime.toDate ? c.checkoutTime.toDate() : new Date(c.checkoutTime)) >= d;
    });
  }

  const container = qs('#checkouts-list');
  if (!list.length) {
    container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📋</div><p>Nenhum check-out encontrado.</p></div>';
    return;
  }

  container.innerHTML = `<div class="checkouts-table-wrap"><table>
    <thead><tr><th>#</th><th>Quarto</th><th>Hóspede</th><th>RSV</th><th>Saldo</th><th>Horário</th><th>Por</th></tr></thead>
    <tbody>${list.map((c, i) => `
      <tr>
        <td style="color:var(--text-dim)">${i + 1}</td>
        <td class="td-room">${c.roomNumber}</td>
        <td>${c.guestName}</td>
        <td style="color:var(--text-dim);font-size:.8rem">${c.rsv || '—'}</td>
        <td style="color:var(--${(c.finalBalance||0) > 0 ? 'orange':'green'})">${R$(c.finalBalance)}</td>
        <td class="td-time">${fmtDate(c.checkoutTime)}</td>
        <td><span class="${c.checkedOutBy === 'admin' ? 'badge-admin' : 'badge-guest'}">${c.checkedOutBy === 'admin' ? '🔑 Admin' : '👤 Hóspede'}</span></td>
      </tr>`).join('')}
    </tbody></table></div>`;
}

function exportCheckoutsExcel() {
  const data = state.allCheckouts;
  if (!data.length) { toast('Nenhum check-out para exportar.', 'warning'); return; }
  const rows = data.map(c => ({
    'Quarto': c.roomNumber,
    'Hóspede': c.guestName,
    'RSV': c.rsv || '',
    'Saldo Final (R$)': Number((c.finalBalance || 0).toFixed(2)),
    'Horário': fmtDate(c.checkoutTime),
    'Realizado por': c.checkedOutBy === 'admin' ? 'Admin' : 'Hóspede',
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Checkouts');
  XLSX.writeFile(wb, `checkouts_${new Date().toISOString().slice(0, 10)}.xlsx`);
  toast('Relatório exportado!', 'success');
}

// ── Admin — Excel Upload ───────────────────────────────────────────────────
let parsedData = [];

function setupUpload() {
  const area = qs('#upload-area');
  const inp = qs('#excel-file');
  area.addEventListener('click', () => inp.click());
  area.addEventListener('dragover', e => { e.preventDefault(); area.classList.add('drag-over'); });
  area.addEventListener('dragleave', () => area.classList.remove('drag-over'));
  area.addEventListener('drop', e => { e.preventDefault(); area.classList.remove('drag-over'); const f = e.dataTransfer.files[0]; if (f) readExcel(f); });
  inp.addEventListener('change', () => { if (inp.files[0]) readExcel(inp.files[0]); inp.value = ''; });
}

function readExcel(file) {
  if (!/\.(xlsx|xls)$/i.test(file.name)) { toast('Selecione um arquivo .xlsx ou .xls', 'warning'); return; }
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const wb = XLSX.read(e.target.result, { type: 'binary' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json(ws, { defval: '' });
      if (!json.length) { toast('Arquivo vazio ou sem dados.', 'error'); return; }

      parsedData = json.map(row => {
        const n = {};
        for (const [k, v] of Object.entries(row)) n[k.toLowerCase().trim().replace(/\s+/g, '')] = v;
        return {
          rsv:        String(n.rsv || '').trim(),
          guestName:  String(n.nome || n.name || n.hóspede || n.hospede || '').trim(),
          roomNumber: String(n.quarto || n.room || n.apt || n.apto || '').trim(),
          balance:    parseBRL(n.saldo || n.balance || n.valor || 0),
          debit:      parseYesNo(n.debitar || n.debit || n.débito || n.debito),
          invoice:    parseYesNo(n.faturar || n.invoice || n.fatura),
        };
      }).filter(r => r.roomNumber && r.guestName);

      if (!parsedData.length) { toast('Nenhum dado válido. Verifique as colunas do Excel.', 'error'); return; }
      showPreview(parsedData);
    } catch (err) {
      toast('Erro ao ler arquivo: ' + err.message, 'error');
    }
  };
  reader.readAsBinaryString(file);
}

function showPreview(data) {
  qs('#preview-table-container').innerHTML = `
    <table>
      <thead><tr><th>RSV</th><th>Nome</th><th>Quarto</th><th>Saldo</th><th>Debitar</th><th>Faturar</th></tr></thead>
      <tbody>${data.slice(0, 20).map(r => `
        <tr>
          <td style="color:var(--text-dim)">${r.rsv}</td>
          <td>${r.guestName}</td>
          <td class="td-room">${r.roomNumber}</td>
          <td style="color:var(--${r.balance > 0 ? 'orange' : 'green'})">${R$(r.balance)}</td>
          <td>${r.debit ? '✅ Sim' : '❌ Não'}</td>
          <td>${r.invoice ? '✅ Sim' : '❌ Não'}</td>
        </tr>`).join('')}
      </tbody>
    </table>
    ${data.length > 20 ? `<p style="padding:8px 16px;color:var(--text-dim);font-size:.8rem">… e mais ${data.length - 20} registros</p>` : ''}`;
  qs('#upload-preview').style.display = '';
  qs('#upload-area').style.display = 'none';
  toast(`${data.length} registros carregados. Confirme para importar.`, 'info');
}

async function confirmImport() {
  if (!parsedData.length) return;
  const btn = qs('#btn-confirm-upload');
  btn.textContent = 'Importando…';
  btn.disabled = true;

  const bar = document.createElement('div');
  bar.className = 'progress-bar-wrap';
  const fill = document.createElement('div');
  fill.className = 'progress-bar';
  fill.style.width = '0%';
  bar.appendChild(fill);
  btn.after(bar);

  try {
    const total = parsedData.length;
    let done = 0;

    for (let i = 0; i < total; i += 400) {
      const chunk = parsedData.slice(i, i + 400);
      const batch = db.batch();

      for (const row of chunk) {
        let snap;
        try {
          snap = await db.collection('rooms').where('roomNumber', '==', row.roomNumber).where('status', '==', 'active').limit(1).get();
        } catch {
          snap = await db.collection('rooms').where('roomNumber', '==', row.roomNumber).limit(1).get();
        }

        const nowSV = SV();
        if (!snap.empty && snap.docs[0].data().status === 'active') {
          batch.update(snap.docs[0].ref, { rsv: row.rsv, guestName: row.guestName, balance: row.balance, debit: row.debit, invoice: row.invoice, updatedAt: nowSV });
        } else {
          batch.set(db.collection('rooms').doc(), { rsv: row.rsv, guestName: row.guestName, roomNumber: row.roomNumber, balance: row.balance, debit: row.debit, invoice: row.invoice, status: 'active', checkoutTime: null, uploadedAt: nowSV, updatedAt: nowSV });
        }
        done++;
        fill.style.width = `${Math.round((done / total) * 100)}%`;
      }
      await batch.commit();
    }

    toast(`✅ ${total} reservas importadas com sucesso!`, 'success');
    cancelImport();
    showTab('rooms');
  } catch (err) {
    toast('Erro na importação: ' + err.message, 'error');
  } finally {
    btn.textContent = '✅ Confirmar Upload';
    btn.disabled = false;
    bar.remove();
  }
}

function cancelImport() {
  parsedData = [];
  qs('#upload-preview').style.display = 'none';
  qs('#upload-area').style.display = '';
  qs('#preview-table-container').innerHTML = '';
}

// ── Notifications ──────────────────────────────────────────────────────────
function subscribeNotifications() {
  if (state.notifUnsubscribe) state.notifUnsubscribe();
  state.notifUnsubscribe = db.collection('notifications').orderBy('createdAt', 'desc').limit(60)
    .onSnapshot(snap => {
      const notifs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const unread = notifs.filter(n => !n.read).length;
      qs('#notification-badge').textContent = unread;
      qs('#notification-badge').style.display = unread > 0 ? '' : 'none';
      renderNotifPanel(notifs);

      snap.docChanges().forEach(ch => {
        if (ch.type === 'added' && !ch.doc.data().read && !ch.doc.metadata.hasPendingWrites) {
          const n = ch.doc.data();
          toast((n.type === 'checkout' ? '🏨 ' : '💰 ') + n.message, 'info', 7000);
        }
      });
    }, console.error);
}

function renderNotifPanel(notifs) {
  const list = qs('#notifications-list');
  if (!notifs.length) { list.innerHTML = '<div class="notif-empty">Sem notificações</div>'; return; }
  list.innerHTML = notifs.map(n => `
    <div class="notif-item ${n.read ? '' : 'unread'}" onclick="window._markNotif('${n.id}')">
      <div class="notif-icon">${n.type === 'checkout' ? '🏨' : '💰'}</div>
      <div class="notif-text">
        <div class="notif-msg">${n.message}</div>
        <div class="notif-time">${fmtDate(n.createdAt)}</div>
      </div>
    </div>`).join('');
}

window._markNotif = async id => {
  try { await db.collection('notifications').doc(id).update({ read: true }); } catch {}
};

async function markAllRead() {
  const snap = await db.collection('notifications').where('read', '==', false).get();
  const batch = db.batch();
  snap.docs.forEach(d => batch.update(d.ref, { read: true }));
  await batch.commit();
}

// ── Handle Mercado Pago return (card checkout) ─────────────────────────────
function handleMPReturn() {
  const p = new URLSearchParams(window.location.search);
  const status = p.get('payment');
  const roomId = p.get('roomId');
  if (!status) return;
  history.replaceState({}, '', location.pathname);

  if (status === 'success') {
    toast('✅ Pagamento aprovado! Faça o check-out agora.', 'success', 8000);
    if (roomId) {
      setTimeout(() => db.collection('rooms').doc(roomId).get().then(doc => {
        if (doc.exists && doc.data().status === 'active') {
          state.foundRoom = { id: doc.id, ...doc.data() };
          state.pendingItems = [];
          renderGuestBalance(state.foundRoom);
        }
      }), 1200);
    }
  } else if (status === 'failure') {
    toast('❌ Pagamento recusado. Tente novamente.', 'error');
  } else if (status === 'pending') {
    toast('⏳ Pagamento pendente. Aguarde a confirmação.', 'warning');
  }
}

// ── Event bindings ─────────────────────────────────────────────────────────
function bindEvents() {
  // Nav
  qs('#btn-admin-login').addEventListener('click', () => showView('admin-login-view'));
  qs('#btn-admin-logout').addEventListener('click', logout);
  qs('#btn-back-guest').addEventListener('click', () => showView('guest-view'));
  qs('#btn-login').addEventListener('click', login);
  qs('#admin-password').addEventListener('keydown', e => e.key === 'Enter' && login());

  // Notifications
  qs('#btn-notifications').addEventListener('click', () => {
    const p = qs('#notification-panel');
    p.style.display = p.style.display === 'none' ? '' : 'none';
  });
  qs('#close-notifications').addEventListener('click', () => { qs('#notification-panel').style.display = 'none'; });
  qs('#btn-mark-all-read').addEventListener('click', markAllRead);
  document.addEventListener('click', e => {
    const p = qs('#notification-panel'), b = qs('#btn-notifications');
    if (p && p.style.display !== 'none' && !p.contains(e.target) && !b.contains(e.target)) p.style.display = 'none';
  });

  // Guest
  qs('#btn-search-guest').addEventListener('click', searchGuest);
  qs('#guest-room').addEventListener('keydown', e => e.key === 'Enter' && searchGuest());
  qs('#guest-name').addEventListener('keydown', e => e.key === 'Enter' && searchGuest());
  qsa('.btn-item').forEach(b => b.addEventListener('click', () => addItem(b.dataset.item, b.dataset.price)));

  // Payment
  qs('#btn-pay-pix').addEventListener('click', startPixPayment);
  qs('#btn-pay-card').addEventListener('click', startCardPayment);
  qs('#close-pix-modal').addEventListener('click', () => {
    qs('#pix-modal').style.display = 'none';
    if (state.pixUnsubscribe) { state.pixUnsubscribe(); state.pixUnsubscribe = null; }
  });
  qs('#pix-modal').addEventListener('click', e => {
    if (e.target === qs('#pix-modal')) {
      qs('#pix-modal').style.display = 'none';
      if (state.pixUnsubscribe) { state.pixUnsubscribe(); state.pixUnsubscribe = null; }
    }
  });
  qs('#btn-copy-pix').addEventListener('click', () => {
    const code = qs('#pix-code-text').textContent;
    navigator.clipboard?.writeText(code).then(() => toast('Código copiado!', 'success', 2000));
  });

  // Checkout modal
  qs('#btn-checkout').addEventListener('click', openCheckoutModal);
  qs('#btn-confirm-checkout').addEventListener('click', confirmCheckout);
  qs('#btn-cancel-checkout').addEventListener('click', () => { qs('#checkout-modal').style.display = 'none'; });
  qs('#checkout-modal').addEventListener('click', e => { if (e.target === qs('#checkout-modal')) qs('#checkout-modal').style.display = 'none'; });

  // Admin tabs
  qsa('.tab-btn').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));

  // Checkouts filters
  qs('#filter-room').addEventListener('input', () => renderCheckouts(state.allCheckouts));
  qs('#filter-date').addEventListener('change', () => renderCheckouts(state.allCheckouts));
  qs('#btn-export-excel').addEventListener('click', exportCheckoutsExcel);

  // Upload
  setupUpload();
  qs('#btn-confirm-upload').addEventListener('click', confirmImport);
  qs('#btn-cancel-upload').addEventListener('click', cancelImport);
}

// ── Bootstrap ──────────────────────────────────────────────────────────────
(function () {
  handleMPReturn();
  bindEvents();
  showView('guest-view');
})();
