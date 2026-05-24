'use strict';
// ── Firebase init ──────────────────────────────────────────────────────────
firebase.initializeApp(firebaseConfig);
const auth     = firebase.auth();
const db       = firebase.firestore();
const storage  = firebase.storage();
const fns      = firebase.functions();

// ── State ──────────────────────────────────────────────────────────────────
const state = {
  user:                  null,
  isAdmin:               false,
  isSuperAdmin:          false,
  foundRoom:             null,
  cart:                  [],
  currentPaymentId:      null,
  allCheckouts:          [],
  allRooms:              [],
  allProducts:           [],
  allPayments:           [],
  allHistory:            [],
  lastPaidRoom:          null,
  lastPaidItems:         [],
  lastPaidBalance:       0,
  pixUnsubscribe:        null,
  roomsUnsubscribe:      null,
  notifUnsubscribe:      null,
  checkoutsUnsubscribe:  null,
  productsUnsubscribe:   null,
  paymentsUnsubscribe:   null,
  historyUnsubscribe:    null,
  uploadMetaUnsubscribe: null,
};

// ── Utils ──────────────────────────────────────────────────────────────────
const R$       = n => 'R$ ' + Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate  = ts => { if (!ts) return '—'; const d = ts.toDate ? ts.toDate() : new Date(ts); return d.toLocaleString('pt-BR'); };
const parseYesNo = v => { if (v == null) return false; return ['sim','s','yes','y','true','1'].includes(String(v).toLowerCase().trim()); };
const parseBRL   = v => { if (v == null || v === '') return 0; return Number(String(v).replace(',', '.')) || 0; };
const qs  = sel => document.querySelector(sel);
const qsa = sel => document.querySelectorAll(sel);
const SV  = firebase.firestore.FieldValue.serverTimestamp;

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
  const el = qs(`#${id}`);
  if (el) el.classList.add('active');
  if (id === 'admin-login-view') {
    const btn = qs('#btn-login');
    if (btn) { btn.textContent = 'Entrar'; btn.disabled = false; }
    const em = qs('#admin-email');   if (em) em.value = '';
    const pw = qs('#admin-password'); if (pw) pw.value = '';
  }
  // Clear guest inputs immediately and again after browser autofill fires
  if (id === 'guest-view') {
    const clear = () => {
      const gn = qs('#guest-name'); if (gn) gn.value = '';
      const gr = qs('#guest-room'); if (gr) gr.value = '';
    };
    clear();
    setTimeout(clear, 80);
    setTimeout(clear, 300);
  }
}

function showTab(id) {
  qsa('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === id));
  qsa('.tab-content').forEach(c => c.classList.toggle('active', c.id === `tab-${id}`));
  if (id === 'rooms')     renderRoomsGrid(state.allRooms);
  if (id === 'checkins')  renderCheckins(state.allRooms);
  if (id === 'products')  renderProductsAdmin(state.allProducts);
  if (id === 'checkouts') renderCheckouts(state.allCheckouts);
  if (id === 'payments')  renderPayments(state.allPayments);
  if (id === 'history')   renderHistory(state.allHistory);
}

// ── Auth ───────────────────────────────────────────────────────────────────
auth.onAuthStateChanged(async user => {
  state.user = user;
  if (user) {
    const adminDoc = await db.collection('admins').doc(user.uid).get().catch(() => null);
    state.isAdmin      = !!(adminDoc && adminDoc.exists);
    state.isSuperAdmin = !!(adminDoc && adminDoc.exists && adminDoc.data()?.superAdmin === true);

    if (state.isAdmin) {
      qs('#btn-admin-login').style.display  = 'none';
      qs('#btn-admin-logout').style.display = '';
      qs('#btn-notifications').style.display = '';
      const btnNew = qs('#btn-new-product');
      if (btnNew) btnNew.style.display = state.isSuperAdmin ? '' : 'none';
      showView('admin-dashboard-view');
      startAdminSubs();
    } else {
      toast('Acesso negado. Usuário não é administrador.', 'error');
      auth.signOut();
    }
  } else {
    state.isAdmin      = false;
    state.isSuperAdmin = false;
    qs('#btn-admin-login').style.display  = '';
    qs('#btn-admin-logout').style.display = 'none';
    qs('#btn-notifications').style.display = 'none';
    stopAdminSubs();
  }
});

async function login() {
  const email = qs('#admin-email').value.trim();
  const pass  = qs('#admin-password').value;
  if (!email || !pass) { toast('Preencha e-mail e senha.', 'warning'); return; }
  const btn = qs('#btn-login');
  btn.textContent = t('entrando');
  btn.disabled = true;
  try {
    await auth.signInWithEmailAndPassword(email, pass);
    // btn state stays until onAuthStateChanged redirects away
  } catch (err) {
    toast('Erro: ' + (err.message || 'Credenciais inválidas.'), 'error');
    btn.textContent = 'Entrar';
    btn.disabled = false;
  }
}

async function logout() {
  stopAdminSubs();
  await auth.signOut();
  // Proactively reset the login button before redirecting
  const btn = qs('#btn-login');
  if (btn) { btn.textContent = 'Entrar'; btn.disabled = false; }
  showView('guest-view');
  toast('Sessão encerrada.', 'info');
}

// ── Guest — Search ─────────────────────────────────────────────────────────
async function searchGuest() {
  const name    = qs('#guest-name').value.trim();
  const roomNum = qs('#guest-room').value.trim();
  if (!name || !roomNum) { toast('Preencha nome e número do quarto.', 'warning'); return; }

  const btn = qs('#btn-search-guest');
  btn.textContent = t('buscando');
  btn.disabled = true;

  try {
    let snap;
    try {
      snap = await db.collection('rooms').where('roomNumber', '==', roomNum).where('status', '==', 'active').get();
    } catch {
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
    state.cart = [];

    // Check if room requires front-desk attendance
    if (state.foundRoom.requiresReception) {
      qs('.guest-search-card').style.display = 'none';
      qs('#guest-balance-view').style.display = 'none';
      qs('#reception-alert-view').style.display = '';
      qs('#reception-alert-view').scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }

    renderGuestBalance(state.foundRoom);
    // Show product catalog
    qs('#products-section').style.display = '';
    renderProductsGuest(state.allProducts);
    // Mobile: auto-scroll to balance section
    setTimeout(() => qs('#guest-balance-view')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
  } catch (err) {
    toast('Erro ao buscar quarto: ' + err.message, 'error');
  } finally {
    btn.textContent = t('search_btn');
    btn.disabled = false;
  }
}

function renderGuestBalance(room) {
  qs('#display-room-number').textContent = room.roomNumber;
  qs('#display-guest-name').textContent  = room.guestName;
  qs('#display-rsv').textContent         = 'RSV: ' + (room.rsv || '—');

  const bal   = room.balance || 0;
  const balEl = qs('#display-balance');
  balEl.textContent = R$(bal);
  balEl.className   = 'balance-amount ' + (bal > 0 ? 'neon-pink' : 'neon-green');

  qs('#guest-balance-view').style.display = '';
  refreshGuestUI(bal);
}

function refreshGuestUI(balance) {
  const cartTotal  = state.cart.reduce((s, i) => s + i.price, 0);
  const grandTotal = balance + cartTotal;

  // Cart section — null-guard in case old HTML cached without #cart-items-list
  const cartSection = qs('#cart-items-section');
  const cartList    = qs('#cart-items-list');
  if (cartSection && cartList) {
    if (state.cart.length > 0) {
      cartSection.style.display = '';
      cartList.innerHTML = state.cart.map((item, idx) =>
        `<div class="item-row">
          <span class="item-row-name">${item.name}</span>
          <span class="item-row-price">${R$(item.price)}</span>
          <button class="btn-remove-cart" data-idx="${idx}" title="Remover">✕</button>
        </div>`
      ).join('');
      cartList.querySelectorAll('.btn-remove-cart').forEach(b =>
        b.addEventListener('click', () => removeFromCart(+b.dataset.idx))
      );
    } else {
      cartSection.style.display = 'none';
      cartList.innerHTML = '';
    }
  }

  const paySection = qs('#payment-section');
  const coSection  = qs('#checkout-section');
  if (grandTotal > 0) {
    if (paySection) { paySection.style.display = ''; }
    const totalEl = qs('#payment-total-amount');
    if (totalEl) totalEl.textContent = R$(grandTotal);
    if (coSection) coSection.style.display = 'none';
  } else {
    if (paySection) paySection.style.display = 'none';
    if (coSection) coSection.style.display = '';
  }
}

function removeFromCart(idx) {
  state.cart.splice(idx, 1);
  refreshGuestUI(state.foundRoom.balance || 0);
}

function addToCartById(productId) {
  const product = state.allProducts.find(p => p.id === productId);
  if (!product) return;
  state.cart.push({ name: product.name, price: product.price, productId: product.id });
  refreshGuestUI(state.foundRoom.balance || 0);
  toast(`${product.name} adicionado.`, 'success', 2000);
}
window.addToCartById = addToCartById;

// ── Products — Subscribe (global, works for guests too) ───────────────────
function subscribeProductsGlobal() {
  if (state.productsUnsubscribe) state.productsUnsubscribe();
  state.productsUnsubscribe = db.collection('products').orderBy('createdAt')
    .onSnapshot(snap => {
      state.allProducts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      if (state.foundRoom)  renderProductsGuest(state.allProducts);
      if (state.isAdmin)    renderProductsAdmin(state.allProducts);
    }, console.error);
}

// ── Products — Guest View ──────────────────────────────────────────────────
function renderProductsGuest(products) {
  const grid   = qs('#products-grid-guest');
  if (!grid) return;

  const search    = (qs('#product-search')?.value || '').toLowerCase();
  const available = products.filter(p => p.available !== false);
  const filtered  = search
    ? available.filter(p => p.name.toLowerCase().includes(search) || (p.description || '').toLowerCase().includes(search))
    : available;

  if (!filtered.length) {
    grid.innerHTML = `<div class="prod-empty">${search ? 'Nenhum produto encontrado.' : 'Sem produtos disponíveis no momento.'}</div>`;
    return;
  }

  grid.innerHTML = filtered.map(p => `
    <div class="prod-card-guest">
      ${p.imageUrl
        ? `<div class="prod-img-wrap"><img src="${p.imageUrl}" alt="${p.name}" class="prod-img" loading="lazy" onerror="this.parentElement.style.display='none'"></div>`
        : `<div class="prod-img-placeholder">🛒</div>`}
      <div class="prod-card-body">
        <div class="prod-name">${p.name}</div>
        ${p.description ? `<div class="prod-desc">${p.description}</div>` : ''}
        <div class="prod-footer">
          <div class="prod-price">${R$(p.price)}</div>
          <button class="btn-add-prod" data-id="${p.id}">+ Adicionar</button>
        </div>
      </div>
    </div>`).join('');

  grid.querySelectorAll('.btn-add-prod').forEach(btn =>
    btn.addEventListener('click', () => addToCartById(btn.dataset.id))
  );
}

// ── Products — Admin View ──────────────────────────────────────────────────
function renderProductsAdmin(products) {
  const container = qs('#products-admin-grid');
  if (!container) return;

  const search   = (qs('#filter-prod-admin')?.value || '').toLowerCase();
  const filtered = search ? products.filter(p => p.name.toLowerCase().includes(search)) : products;

  if (!filtered.length) {
    const hint = state.isSuperAdmin ? ' Clique em <strong>+ Novo Produto</strong> para adicionar.' : '.';
    container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📦</div><p>Nenhum produto cadastrado${hint}</p></div>`;
    return;
  }

  container.innerHTML = `<div class="checkouts-table-wrap">
    <table>
      <thead><tr>
        <th style="width:54px">Img</th>
        <th>Nome</th>
        <th>Descrição</th>
        <th>Preço</th>
        <th>Status</th>
        ${state.isSuperAdmin ? '<th>Ações</th>' : ''}
      </tr></thead>
      <tbody>${filtered.map(p => `
        <tr>
          <td>
            ${p.imageUrl
              ? `<img src="${p.imageUrl}" alt="" style="width:42px;height:42px;object-fit:cover;border-radius:8px;border:1px solid var(--b-subtle)" onerror="this.style.display='none'">`
              : `<span style="font-size:1.4rem;opacity:.4">🛒</span>`}
          </td>
          <td style="font-weight:600">${p.name}</td>
          <td style="color:var(--text-sub);font-size:.83rem">${p.description || '—'}</td>
          <td style="font-family:'Playfair Display',serif;font-weight:700;color:var(--blue)">${R$(p.price)}</td>
          <td><span class="${p.available !== false ? 'badge-admin' : 'badge-guest'}">${p.available !== false ? '✅ Ativo' : '⏸ Inativo'}</span></td>
          ${state.isSuperAdmin ? `<td><button class="btn-secondary btn-sm btn-edit-prod" data-id="${p.id}">Editar</button></td>` : ''}
        </tr>`).join('')}
      </tbody>
    </table>
  </div>`;

  container.querySelectorAll('.btn-edit-prod').forEach(btn =>
    btn.addEventListener('click', () => openProductModal(btn.dataset.id))
  );
}

function openProductModal(productId = null) {
  const isEdit = !!productId;
  qs('#product-modal-title').textContent = isEdit ? 'Editar Produto' : 'Novo Produto';
  qs('#prod-edit-id').value = productId || '';
  qs('#btn-delete-product').style.display = isEdit ? '' : 'none';

  if (isEdit) {
    const p = state.allProducts.find(x => x.id === productId);
    if (!p) return;
    qs('#prod-name').value      = p.name || '';
    qs('#prod-desc').value      = p.description || '';
    qs('#prod-price').value     = p.price || '';
    qs('#prod-image-url').value = p.imageUrl || '';
    qs('#prod-available').checked = p.available !== false;
    if (p.imageUrl) {
      qs('#prod-image-preview').src = p.imageUrl;
      qs('#prod-image-preview-wrap').style.display = '';
    } else {
      qs('#prod-image-preview-wrap').style.display = 'none';
    }
  } else {
    qs('#prod-name').value      = '';
    qs('#prod-desc').value      = '';
    qs('#prod-price').value     = '';
    qs('#prod-image-url').value = '';
    qs('#prod-available').checked = true;
    qs('#prod-image-preview-wrap').style.display = 'none';
  }

  qs('#product-modal').style.display = 'flex';
  setTimeout(() => qs('#prod-name').focus(), 80);
}

async function saveProduct() {
  const id        = qs('#prod-edit-id').value;
  const name      = qs('#prod-name').value.trim();
  const desc      = qs('#prod-desc').value.trim();
  const price     = parseFloat(qs('#prod-price').value);
  const imageUrl  = qs('#prod-image-url').value.trim();
  const available = qs('#prod-available').checked;

  if (!name)           { toast('Nome do produto é obrigatório.', 'warning'); return; }
  if (!price || price <= 0) { toast('Preço inválido.', 'warning'); return; }

  const btn = qs('#btn-save-product');
  btn.textContent = 'Salvando…';
  btn.disabled = true;

  try {
    const data = { name, description: desc, price, imageUrl, available, updatedAt: SV() };
    if (id) {
      await db.collection('products').doc(id).update(data);
      toast('Produto atualizado!', 'success');
    } else {
      await db.collection('products').add({ ...data, createdAt: SV() });
      toast('Produto adicionado!', 'success');
    }
    qs('#product-modal').style.display = 'none';
  } catch (err) {
    toast('Erro: ' + err.message, 'error');
  } finally {
    btn.textContent = 'Salvar';
    btn.disabled = false;
  }
}

async function deleteProduct() {
  const id = qs('#prod-edit-id').value;
  if (!id) return;
  if (!confirm('Excluir este produto permanentemente?')) return;
  try {
    await db.collection('products').doc(id).delete();
    toast('Produto excluído.', 'info');
    qs('#product-modal').style.display = 'none';
  } catch (err) {
    toast('Erro: ' + err.message, 'error');
  }
}

async function handleProductImageUpload(file) {
  if (!file) return;
  const btn = qs('#btn-save-product');
  btn.textContent = 'Enviando…';
  btn.disabled = true;
  try {
    const ext = file.name.split('.').pop().toLowerCase();
    const ref = storage.ref(`products/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`);
    await ref.put(file, { contentType: file.type });
    const url = await ref.getDownloadURL();
    qs('#prod-image-url').value = url;
    qs('#prod-image-preview').src = url;
    qs('#prod-image-preview-wrap').style.display = '';
    toast('Imagem enviada.', 'success', 2000);
  } catch (err) {
    toast('Erro ao enviar imagem: ' + err.message, 'error');
  } finally {
    btn.textContent = 'Salvar';
    btn.disabled = false;
  }
}

// ── Guest — PIX ────────────────────────────────────────────────────────────
async function startPixPayment() {
  const bal       = state.foundRoom.balance || 0;
  const cartTotal = state.cart.reduce((s, i) => s + i.price, 0);
  const total     = +(bal + cartTotal).toFixed(2);
  if (total <= 0) { toast('Saldo zerado. Faça o check-out.', 'info'); return; }

  qs('#pix-amount-display').textContent = R$(total);
  qs('#pix-loading').style.display    = '';
  qs('#pix-qr-content').style.display = 'none';
  qs('#pix-success').style.display    = 'none';
  qs('#pix-modal').style.display      = 'flex';

  try {
    const { data } = await fns.httpsCallable('createPixPayment')({
      amount:     total,
      roomId:     state.foundRoom.id,
      guestName:  state.foundRoom.guestName,
      roomNumber: state.foundRoom.roomNumber,
      rsv:        state.foundRoom.rsv || '',
      items:      state.cart,
    });

    state.currentPaymentId = data.paymentId;
    qs('#pix-loading').style.display    = 'none';
    qs('#pix-qr-content').style.display = '';

    const canvas = qs('#pix-qr-canvas');
    if (data.pixCodeBase64) {
      canvas.outerHTML = `<img id="pix-qr-canvas" src="data:image/png;base64,${data.pixCodeBase64}"
        style="max-width:220px;border-radius:12px;border:3px solid var(--b-strong);padding:8px;background:#fff;box-shadow:0 0 30px var(--blue-glow)">`;
    } else if (data.pixCode && typeof QRCode !== 'undefined') {
      QRCode.toCanvas(qs('#pix-qr-canvas'), data.pixCode, { width: 220, margin: 1, color: { dark: '#000', light: '#fff' } });
    }
    qs('#pix-code-text').textContent = data.pixCode || '';

    if (state.pixUnsubscribe) state.pixUnsubscribe();
    state.pixUnsubscribe = db.collection('payments').doc(data.paymentId)
      .onSnapshot(doc => { if (doc.data()?.status === 'approved') onPaymentApproved(); });

  } catch (err) {
    qs('#pix-modal').style.display = 'none';
    toast('Erro ao gerar PIX: ' + (err.message || 'Tente novamente.'), 'error');
    console.error(err);
  }
}

function onPaymentApproved() {
  if (state.pixUnsubscribe) { state.pixUnsubscribe(); state.pixUnsubscribe = null; }

  // Save for guest receipt before clearing state
  if (state.foundRoom) {
    state.lastPaidRoom    = { ...state.foundRoom };
    state.lastPaidItems   = [...state.cart];
    state.lastPaidBalance = state.foundRoom.balance || 0;
  }

  qs('#pix-loading').style.display    = 'none';
  qs('#pix-qr-content').style.display = 'none';
  qs('#pix-success').style.display    = '';
  if (state.foundRoom) {
    state.foundRoom.balance = 0;
    state.cart = [];
    renderGuestBalance(state.foundRoom);
  }

  // Show receipt button in checkout section
  const recBtn = qs('#btn-guest-receipt');
  if (recBtn) recBtn.style.display = '';

  toast('Pagamento PIX confirmado! Você pode fazer o check-out.', 'success', 7000);
}

// ── Guest — Cartão / Google Pay ────────────────────────────────────────────
async function startCardPayment() {
  const bal       = state.foundRoom.balance || 0;
  const cartTotal = state.cart.reduce((s, i) => s + i.price, 0);
  const total     = +(bal + cartTotal).toFixed(2);
  if (total <= 0) { toast('Saldo zerado. Faça o check-out.', 'info'); return; }

  const btn = qs('#btn-pay-card');
  btn.textContent = 'Aguarde…';
  btn.disabled = true;

  try {
    const { data } = await fns.httpsCallable('createCardPreference')({
      amount:     total,
      roomId:     state.foundRoom.id,
      guestName:  state.foundRoom.guestName,
      roomNumber: state.foundRoom.roomNumber,
      rsv:        state.foundRoom.rsv || '',
      items:      state.cart,
    });
    window.location.href = data.initPoint;
  } catch (err) {
    toast('Erro ao iniciar pagamento: ' + err.message, 'error');
    btn.textContent = 'Cartão / Google Pay';
    btn.disabled = false;
  }
}

// ── Guest — Checkout ───────────────────────────────────────────────────────
function openCheckoutModal() {
  qs('#checkout-room-display').textContent  = state.foundRoom.roomNumber;
  qs('#checkout-guest-display').textContent = state.foundRoom.guestName;
  qs('#checkout-modal').style.display = 'flex';
}

async function confirmCheckout() {
  const room = state.foundRoom;
  const btn  = qs('#btn-confirm-checkout');
  btn.textContent = t('processando');
  btn.disabled = true;

  try {
    const batch = db.batch();
    const now   = SV();
    const coData = {
      roomId: room.id, rsv: room.rsv || '', roomNumber: room.roomNumber,
      guestName: room.guestName, finalBalance: room.balance || 0,
      checkoutTime: now, checkedOutBy: 'guest', adminUid: null,
    };

    // Rule allows: active room + balance==0 → status='checked-out'
    batch.update(db.collection('rooms').doc(room.id), {
      status: 'checked-out', checkoutTime: now, updatedAt: now,
    });
    batch.set(db.collection('checkouts').doc(),       coData);
    batch.set(db.collection('checkoutHistory').doc(), coData); // permanent, never deleted
    batch.set(db.collection('notifications').doc(), {
      type: 'checkout',
      message: `🏨 Check-out — Quarto ${room.roomNumber} — ${room.guestName}`,
      roomNumber: room.roomNumber, roomId: room.id,
      amount: null, method: null, read: false, createdAt: now,
    });

    await batch.commit();
    qs('#checkout-modal').style.display = 'none';
    state.foundRoom = null;
    state.cart = [];
    showCheckoutSuccess(room);
  } catch (err) {
    toast('Erro ao fazer check-out: ' + err.message, 'error');
    btn.textContent = t('confirmar');
    btn.disabled = false;
  }
}

function showCheckoutSuccess(room) {
  qs('.guest-search-card').style.display = 'none';
  qs('#guest-balance-view').style.display = 'none';
  const banner = qs('#checkout-success-banner');
  qs('#checkout-success-room').innerHTML = `Quarto <strong style="color:var(--text)">${room.roomNumber}</strong> — ${room.guestName}`;
  banner.style.display = '';
}

function resetGuestView() {
  qs('#checkout-success-banner').style.display = 'none';
  qs('#reception-alert-view').style.display    = 'none';
  qs('.guest-search-card').style.display       = '';
  qs('#guest-balance-view').style.display      = 'none';
  qs('#products-section').style.display        = 'none';
  const recBtn = qs('#btn-guest-receipt');
  if (recBtn) recBtn.style.display = 'none';
  const gn = qs('#guest-name');   if (gn) gn.value = '';
  const gr = qs('#guest-room');   if (gr) gr.value = '';
  state.foundRoom = null;
  state.cart = [];
}

// ── Admin — Subscriptions ──────────────────────────────────────────────────
function startAdminSubs() {
  subscribeRooms();
  subscribeCheckouts();
  subscribeNotifications();
  subscribePayments();
  subscribeHistory();
  subscribeUploadMeta();
}
function stopAdminSubs() {
  [
    state.roomsUnsubscribe, state.checkoutsUnsubscribe, state.notifUnsubscribe,
    state.paymentsUnsubscribe, state.historyUnsubscribe, state.uploadMetaUnsubscribe,
  ].forEach(fn => fn && fn());
  state.roomsUnsubscribe = state.checkoutsUnsubscribe = state.notifUnsubscribe =
  state.paymentsUnsubscribe = state.historyUnsubscribe = state.uploadMetaUnsubscribe = null;
}

// ── Admin — Rooms ──────────────────────────────────────────────────────────
function subscribeRooms() {
  if (state.roomsUnsubscribe) state.roomsUnsubscribe();
  state.roomsUnsubscribe = db.collection('rooms').orderBy('roomNumber')
    .onSnapshot(snap => {
      state.allRooms = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderRoomsGrid(state.allRooms);
      renderCheckins(state.allRooms);
    }, console.error);
}

function renderRoomsGrid(rooms) {
  const grid  = qs('#rooms-grid');
  const textF = (qs('#filter-rooms-text')?.value || '').toLowerCase();
  const sortF = qs('#sort-rooms')?.value || 'number';

  // Filter
  let filtered = textF
    ? rooms.filter(r =>
        r.roomNumber?.toLowerCase().includes(textF) ||
        r.guestName?.toLowerCase().includes(textF))
    : rooms;

  // Sort
  const sorted = [...filtered].sort((a, b) => {
    switch (sortF) {
      case 'balance-desc': return (b.balance || 0) - (a.balance || 0);
      case 'balance-asc':  return (a.balance || 0) - (b.balance || 0);
      case 'name':         return (a.guestName || '').localeCompare(b.guestName || '');
      default: return (a.roomNumber || '').localeCompare(b.roomNumber || '', undefined, { numeric: true });
    }
  });

  if (!sorted.length) {
    grid.innerHTML = rooms.length
      ? '<div class="empty-state"><div class="empty-state-icon">🔍</div><p>Nenhum quarto encontrado com esse filtro.</p></div>'
      : '<div class="empty-state"><div class="empty-state-icon">🏨</div><p>Nenhum quarto. Use a aba <strong>Upload</strong> para importar reservas.</p></div>';
    return;
  }

  const active  = rooms.filter(r => r.status === 'active').length;
  const couted  = rooms.filter(r => r.status === 'checked-out').length;
  const withBal = rooms.filter(r => r.status === 'active' && (r.balance || 0) > 0).length;

  const stats = `
    <div style="grid-column:1/-1;display:flex;gap:10px;flex-wrap:wrap;margin-bottom:8px">
      <div class="stat-chip"><strong style="color:var(--text)">${active}</strong><span style="color:var(--text-sub)">ativos</span></div>
      <div class="stat-chip"><strong style="color:var(--warn)">${withBal}</strong><span style="color:var(--text-sub)">com saldo</span></div>
      <div class="stat-chip"><strong style="color:var(--success)">${couted}</strong><span style="color:var(--text-sub)">check-out</span></div>
    </div>`;

  grid.innerHTML = stats + sorted.map(r => {
    const bal         = r.balance || 0;
    const isOut       = r.status === 'checked-out';
    const cardClass   = isOut ? 'checked-out' : (bal > 0 ? 'has-balance' : 'no-balance');
    const canCheckout = !isOut && bal === 0;
    const needsRec    = r.requiresReception ? '<span class="flag flag-reception">📞 Recep.</span>' : '';
    const catLabel    = r.balanceCategory && !isOut ? `<span class="flag flag-cat">${r.balanceCategory}</span>` : '';
    const balLabel    = isOut
      ? '<span style="color:var(--success)">Saída</span>'
      : `<span style="color:${bal > 0 ? 'var(--warn)' : 'var(--success)'}">${R$(bal)}</span>`;
    return `<div class="room-card ${cardClass}${r.requiresReception ? ' needs-reception' : ''}">
      <div class="room-card-num">${r.roomNumber}</div>
      <div class="room-card-name">${r.guestName}</div>
      <div class="room-card-rsv">RSV: ${r.rsv || '—'}</div>
      <div class="room-card-balance">${balLabel}</div>
      <div class="room-card-flags">
        ${r.debit   ? '<span class="flag flag-debit">Débito</span>'  : ''}
        ${r.invoice ? '<span class="flag flag-invoice">Fatura</span>' : ''}
        ${needsRec}${catLabel}
      </div>
      ${r.observations ? `<div class="room-card-obs">${r.observations}</div>` : ''}
      <div class="room-card-actions">
        <button class="btn-admin-checkout" data-id="${r.id}" ${!canCheckout ? 'disabled' : ''}>
          ${isOut ? '✅ Feito' : (bal > 0 ? '⚠ Saldo pend.' : 'Check-Out')}
        </button>
        ${!isOut ? `<button class="btn-room-edit btn-ghost btn-sm" data-id="${r.id}">✏</button>` : ''}
      </div>
    </div>`;
  }).join('');

  grid.querySelectorAll('.btn-admin-checkout:not([disabled])').forEach(btn =>
    btn.addEventListener('click', () => adminCheckout(btn.dataset.id))
  );
  grid.querySelectorAll('.btn-room-edit').forEach(btn =>
    btn.addEventListener('click', () => openRoomEdit(btn.dataset.id))
  );
}

async function adminCheckout(roomId) {
  if (!confirm('Confirmar check-out deste quarto?')) return;
  try {
    await fns.httpsCallable('adminCheckoutRoom')({ roomId });
    toast('Check-out realizado pelo admin!', 'success');
  } catch (err) {
    toast('Erro: ' + err.message, 'error');
  }
}

// ── Admin — Check-Ins ──────────────────────────────────────────────────────
function renderCheckins(rooms) {
  const nameF = (qs('#filter-checkin-name')?.value || '').toLowerCase();
  const roomF = (qs('#filter-checkin-room')?.value || '').toLowerCase();

  let list = rooms.filter(r => r.status === 'active');
  if (nameF) list = list.filter(r => r.guestName.toLowerCase().includes(nameF));
  if (roomF) list = list.filter(r => r.roomNumber.toLowerCase().includes(roomF));

  const container = qs('#checkins-list');
  if (!container) return;

  if (!list.length) {
    container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🏨</div><p>Nenhuma reserva ativa encontrada.</p></div>';
    return;
  }

  container.innerHTML = `<div class="checkouts-table-wrap"><table>
    <thead><tr>
      <th>#</th><th>Quarto</th><th>Hóspede</th><th>RSV</th>
      <th>Saldo</th><th>Débito</th><th>Fatura</th><th>Importado em</th>
    </tr></thead>
    <tbody>${list.map((r, i) => `
      <tr>
        <td style="color:var(--text-dim)">${i + 1}</td>
        <td class="td-room">${r.roomNumber}</td>
        <td style="font-weight:600">${r.guestName}</td>
        <td style="color:var(--text-dim);font-size:.8rem">${r.rsv || '—'}</td>
        <td style="color:var(--${(r.balance||0) > 0 ? 'warn':'success'})">${R$(r.balance)}</td>
        <td>${r.debit   ? '<span class="flag flag-debit">Sim</span>'    : '<span style="color:var(--text-dim)">Não</span>'}</td>
        <td>${r.invoice ? '<span class="flag flag-invoice">Sim</span>'  : '<span style="color:var(--text-dim)">Não</span>'}</td>
        <td class="td-time">${fmtDate(r.uploadedAt || r.updatedAt)}</td>
      </tr>`).join('')}
    </tbody></table></div>`;
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
        <td style="color:var(--${(c.finalBalance||0) > 0 ? 'warn':'success'})">${R$(c.finalBalance)}</td>
        <td class="td-time">${fmtDate(c.checkoutTime)}</td>
        <td><span class="${c.checkedOutBy === 'admin' ? 'badge-admin' : 'badge-guest'}">${c.checkedOutBy === 'admin' ? '🔑 Admin' : '👤 Hóspede'}</span></td>
      </tr>`).join('')}
    </tbody></table></div>`;
}

function exportCheckoutsExcel() {
  if (!state.allCheckouts.length) { toast('Nenhum check-out para exportar.', 'warning'); return; }
  const rows = state.allCheckouts.map(c => ({
    'Quarto': c.roomNumber, 'Hóspede': c.guestName, 'RSV': c.rsv || '',
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

// ── Admin — Histórico permanente ──────────────────────────────────────────────
function subscribeHistory() {
  if (state.historyUnsubscribe) state.historyUnsubscribe();
  state.historyUnsubscribe = db.collection('checkoutHistory')
    .orderBy('checkoutTime', 'desc').limit(1000)
    .onSnapshot(snap => {
      state.allHistory = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderHistory(state.allHistory);
    }, console.error);
}

function renderHistory(history) {
  const container = qs('#history-list');
  if (!container) return;

  const textF = (qs('#filter-history')?.value || '').toLowerCase();
  const fromF = qs('#filter-history-from')?.value;
  const toF   = qs('#filter-history-to')?.value;

  let list = history;
  if (textF) list = list.filter(c =>
    c.roomNumber?.toLowerCase().includes(textF) || c.guestName?.toLowerCase().includes(textF));
  if (fromF) {
    const from = new Date(fromF);
    list = list.filter(c => c.checkoutTime && (c.checkoutTime.toDate?.() || new Date(c.checkoutTime)) >= from);
  }
  if (toF) {
    const to = new Date(toF); to.setHours(23, 59, 59, 999);
    list = list.filter(c => c.checkoutTime && (c.checkoutTime.toDate?.() || new Date(c.checkoutTime)) <= to);
  }

  if (!list.length) {
    container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📜</div><p>Nenhum check-out encontrado.</p></div>';
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
        <td style="color:var(--${(c.finalBalance||0) > 0 ? 'warn':'success'})">${R$(c.finalBalance)}</td>
        <td class="td-time">${fmtDate(c.checkoutTime)}</td>
        <td><span class="${c.checkedOutBy === 'admin' ? 'badge-admin' : 'badge-guest'}">${c.checkedOutBy === 'admin' ? '🔑 Admin' : '👤 Hóspede'}</span></td>
      </tr>`).join('')}
    </tbody></table></div>
    <p style="padding:10px 4px;color:var(--text-dim);font-size:.78rem">${list.length} registro(s) • histórico permanente</p>`;
}

function exportHistoryExcel() {
  const list = state.allHistory;
  if (!list.length) { toast('Nenhum histórico para exportar.', 'warning'); return; }
  const rows = list.map(c => ({
    'Quarto': c.roomNumber, 'Hóspede': c.guestName, 'RSV': c.rsv || '',
    'Saldo Final (R$)': Number((c.finalBalance || 0).toFixed(2)),
    'Horário': fmtDate(c.checkoutTime),
    'Realizado por': c.checkedOutBy === 'admin' ? 'Admin' : 'Hóspede',
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Histórico');
  XLSX.writeFile(wb, `historico_checkouts_${new Date().toISOString().slice(0, 10)}.xlsx`);
  toast('Histórico exportado!', 'success');
}

// ── Admin — Room Edit ─────────────────────────────────────────────────────────
function openRoomEdit(roomId) {
  const room = state.allRooms.find(r => r.id === roomId);
  if (!room) return;

  qs('#room-edit-id').value      = roomId;
  qs('#room-edit-balance').value = room.balance || 0;
  qs('#room-edit-obs').value     = room.observations || '';
  qs('#room-edit-reception').checked = room.requiresReception || false;

  qs('#room-edit-header').innerHTML = `
    <div style="display:flex;gap:12px;align-items:center;margin-bottom:16px;padding:12px 14px;
                background:var(--glass-1);border-radius:var(--radius-sm);border:1px solid var(--b-subtle)">
      <div style="font-size:1.5rem;font-weight:700;color:var(--blue-hi);min-width:40px;text-align:center">${room.roomNumber}</div>
      <div>
        <div style="font-weight:600">${room.guestName}</div>
        <div style="color:var(--text-dim);font-size:.8rem">RSV: ${room.rsv || '—'}</div>
      </div>
    </div>`;

  const cat = room.balanceCategory || '';
  qs('#room-edit-category-chips').querySelectorAll('.chip-btn').forEach(c =>
    c.classList.toggle('active', c.dataset.cat === cat)
  );

  qs('#room-edit-modal').style.display = 'flex';
  setTimeout(() => qs('#room-edit-balance').focus(), 80);
}

async function saveRoomEdit() {
  const roomId    = qs('#room-edit-id').value;
  const balance   = Math.max(0, parseFloat(qs('#room-edit-balance').value) || 0);
  const obs       = qs('#room-edit-obs').value.trim();
  const reception = qs('#room-edit-reception').checked;
  const cat       = qs('#room-edit-category-chips .chip-btn.active')?.dataset.cat || '';

  const btn = qs('#btn-save-room-edit');
  btn.textContent = t('salvando');
  btn.disabled    = true;

  try {
    await db.collection('rooms').doc(roomId).update({
      balance, balanceCategory: cat, observations: obs,
      requiresReception: reception, updatedAt: SV(),
    });
    qs('#room-edit-modal').style.display = 'none';
    toast('Reserva atualizada!', 'success');
  } catch (err) {
    toast('Erro: ' + err.message, 'error');
  } finally {
    btn.textContent = t('salvar');
    btn.disabled    = false;
  }
}

// ── Guest — Comprovante de Consumo ────────────────────────────────────────────
function printGuestReceipt() {
  const room  = state.lastPaidRoom;
  const items = state.lastPaidItems || [];
  const bal   = state.lastPaidBalance || 0;
  const total = +(bal + items.reduce((s, i) => s + i.price, 0)).toFixed(2);

  if (!room) { toast('Nenhum comprovante disponível.', 'warning'); return; }

  const itemsHtml = items.map(i =>
    `<tr>
      <td style="padding:4px 0;border-bottom:1px solid #eee;font-size:12px">${i.name}</td>
      <td style="padding:4px 0;border-bottom:1px solid #eee;font-size:12px;text-align:right;font-weight:600">R$ ${Number(i.price).toFixed(2).replace('.',',')}</td>
    </tr>`).join('');

  const html = `<!DOCTYPE html><html><head>
<meta charset="UTF-8"><title>Comprovante</title>
<style>
  body{font-family:Arial,sans-serif;padding:32px 28px;color:#111;font-size:14px}
  h1{font-size:17px;margin-bottom:2px}.sub{color:#666;font-size:11px;margin-bottom:20px}
  table.info{width:100%;border-collapse:collapse}
  table.info td{padding:6px 0;border-bottom:1px solid #eee;font-size:13px;vertical-align:top}
  table.info td:first-child{color:#666;width:38%}table.info td:last-child{font-weight:600}
  .total{font-size:17px;font-weight:700;color:#1a56db}
  .footer{margin-top:28px;font-size:10px;color:#999;text-align:center;border-top:1px dashed #ddd;padding-top:12px}
  .print-btn{margin-top:20px;padding:10px 22px;background:#2563eb;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px;font-weight:600}
  @media print{.print-btn{display:none}}
</style></head><body>
  <h1>Comprovante de Consumo</h1>
  <div class="sub">Fast Check-Out · Hotel</div>
  <table class="info">
    <tr><td>Quarto</td><td>${room.roomNumber}</td></tr>
    <tr><td>Hóspede</td><td>${room.guestName}</td></tr>
    <tr><td>RSV</td><td>${room.rsv || '—'}</td></tr>
    ${bal > 0 ? `<tr><td>Hospedagem</td><td>R$ ${Number(bal).toFixed(2).replace('.',',')}</td></tr>` : ''}
    ${itemsHtml ? `<tr><td>Consumo</td><td><table style="width:100%">${itemsHtml}</table></td></tr>` : ''}
    <tr><td>Total</td><td class="total">R$ ${total.toFixed(2).replace('.',',')}</td></tr>
    <tr><td>Data / Hora</td><td>${new Date().toLocaleString('pt-BR')}</td></tr>
  </table>
  <div class="footer">Comprovante gerado automaticamente · Fast Check-Out Hotel<br>${new Date().toLocaleString('pt-BR')}</div>
  <br><button class="print-btn" onclick="window.print()">🖨 Imprimir / Salvar PDF</button>
</body></html>`;

  const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
  const w   = window.open(url, '_blank', 'width=460,height=620');
  w?.focus();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
window.printGuestReceipt = printGuestReceipt;

// ── Admin — Payments ──────────────────────────────────────────────────────────
function subscribePayments() {
  if (state.paymentsUnsubscribe) state.paymentsUnsubscribe();
  state.paymentsUnsubscribe = db.collection('payments').orderBy('createdAt', 'desc')
    .onSnapshot(snap => {
      state.allPayments = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderPayments(state.allPayments);
    }, console.error);
}

function renderPayments(payments) {
  const container = qs('#payments-list');
  if (!container) return;

  const textF   = (qs('#filter-payment')?.value || '').toLowerCase();
  const methodF = qs('#filter-payment-method')?.value || '';
  const statusF = qs('#filter-payment-status') ? (qs('#filter-payment-status').value ?? 'approved') : 'approved';

  let list = payments;
  if (textF)   list = list.filter(p => p.roomNumber?.toLowerCase().includes(textF) || p.guestName?.toLowerCase().includes(textF));
  if (methodF) list = list.filter(p => p.method === methodF);
  if (statusF) list = list.filter(p => p.status === statusF);

  if (!list.length) {
    container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">💰</div><p>Nenhum pagamento encontrado.</p></div>';
    return;
  }

  const approved = list.filter(p => p.status === 'approved').length;
  const total    = list.filter(p => p.status === 'approved').reduce((s, p) => s + (p.amount || 0), 0);

  const summary = `
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px">
      <div class="stat-chip"><strong style="color:var(--success)">${approved}</strong><span style="color:var(--text-sub)">aprovados</span></div>
      <div class="stat-chip"><strong style="color:var(--blue)">${R$(total)}</strong><span style="color:var(--text-sub)">total recebido</span></div>
    </div>`;

  container.innerHTML = summary + `<div class="checkouts-table-wrap"><table>
    <thead><tr>
      <th>#</th><th>Quarto</th><th>Hóspede</th><th>RSV</th>
      <th>Método</th><th>Valor</th><th>Status</th><th>Horário</th><th>Comprovante</th>
    </tr></thead>
    <tbody>${list.map((p, i) => {
      const method  = p.method === 'pix' ? '🔷 PIX' : '💳 Cartão';
      const status  = p.status === 'approved'
        ? '<span class="badge-admin">✅ Aprovado</span>'
        : p.status === 'rejected'
        ? '<span style="color:var(--danger);font-size:.78rem;font-weight:600">❌ Recusado</span>'
        : '<span class="badge-guest">⏳ Pendente</span>';
      return `<tr>
        <td style="color:var(--text-dim)">${i + 1}</td>
        <td class="td-room">${p.roomNumber || '—'}</td>
        <td style="font-weight:600">${p.guestName || '—'}</td>
        <td style="color:var(--text-dim);font-size:.8rem">${p.rsv || '—'}</td>
        <td>${method}</td>
        <td style="font-family:'Playfair Display',serif;font-weight:700;color:var(--blue)">${R$(p.amount)}</td>
        <td>${status}</td>
        <td class="td-time">${fmtDate(p.createdAt)}</td>
        <td><button class="btn-secondary btn-sm btn-print-receipt" data-id="${p.id}" ${p.status !== 'approved' ? 'disabled' : ''}>🖨 Imprimir</button></td>
      </tr>`;
    }).join('')}
    </tbody></table></div>`;

  container.querySelectorAll('.btn-print-receipt:not([disabled])').forEach(btn =>
    btn.addEventListener('click', () => {
      const p = state.allPayments.find(x => x.id === btn.dataset.id);
      if (p) printReceipt(p);
    })
  );
}

function printReceipt(payment) {
  const method = payment.method === 'pix' ? 'PIX' : 'Cartão de Crédito / Google Pay';
  const mpId   = payment.mercadoPagoId || payment.preferenceId || '—';
  const items  = (payment.items || []).length > 0
    ? `<table style="width:100%;border-collapse:collapse;margin:8px 0">
        ${payment.items.map(i => `<tr>
          <td style="padding:4px 0;border-bottom:1px solid #eee;font-size:12px">${i.name}</td>
          <td style="padding:4px 0;border-bottom:1px solid #eee;font-size:12px;text-align:right;font-weight:600">R$ ${Number(i.price).toFixed(2).replace('.',',')}</td>
        </tr>`).join('')}
      </table>`
    : '';

  const html = `<!DOCTYPE html><html><head>
<meta charset="UTF-8"><title>Comprovante</title>
<style>
  body{font-family:Arial,sans-serif;padding:32px 28px;color:#111;font-size:14px}
  h1{font-size:17px;margin-bottom:2px}
  .sub{color:#666;font-size:11px;margin-bottom:20px}
  table.info{width:100%;border-collapse:collapse}
  table.info td{padding:6px 0;border-bottom:1px solid #eee;font-size:13px;vertical-align:top}
  table.info td:first-child{color:#666;width:38%}
  table.info td:last-child{font-weight:600}
  .total{font-size:17px;font-weight:700;color:#1a56db}
  .stamp{display:inline-block;border:2px solid #16a34a;color:#16a34a;border-radius:4px;padding:2px 10px;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase}
  .footer{margin-top:28px;font-size:10px;color:#999;text-align:center;border-top:1px dashed #ddd;padding-top:12px}
  .print-btn{margin-top:20px;padding:10px 22px;background:#2563eb;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px;font-weight:600}
  @media print{.print-btn{display:none}}
</style></head>
<body>
  <h1>Comprovante de Pagamento</h1>
  <div class="sub">Fast Check-Out · Hotel</div>
  <table class="info">
    <tr><td>Quarto</td><td>${payment.roomNumber || '—'}</td></tr>
    <tr><td>Hóspede</td><td>${payment.guestName || '—'}</td></tr>
    <tr><td>RSV</td><td>${payment.rsv || '—'}</td></tr>
    <tr><td>Forma de Pagamento</td><td>${method}</td></tr>
    ${items ? `<tr><td>Consumo</td><td>${items}</td></tr>` : ''}
    <tr><td>Valor Total</td><td class="total">R$ ${Number(payment.amount).toFixed(2).replace('.',',')}</td></tr>
    <tr><td>Status</td><td><span class="stamp">Aprovado</span></td></tr>
    <tr><td>Data / Hora</td><td>${fmtDate(payment.createdAt)}</td></tr>
    <tr><td>ID Mercado Pago</td><td style="font-size:11px;word-break:break-all">${mpId}</td></tr>
  </table>
  <div class="footer">Comprovante gerado automaticamente · Fast Check-Out Hotel<br>${new Date().toLocaleString('pt-BR')}</div>
  <br>
  <button class="print-btn" onclick="window.print()">🖨 Imprimir / Salvar PDF</button>
</body></html>`;

  const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
  const w   = window.open(url, '_blank', 'width=460,height=680');
  w?.focus();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
window.printReceipt = printReceipt;

async function clearDayData() {
  if (!confirm('⚠️ Isso apagará TODOS os quartos, check-outs e notificações.\nOs comprovantes de pagamento (PIX/cartão) são preservados.\n\nContinuar?')) return;

  const btn = qs('#btn-clear-day');
  btn.textContent = 'Limpando…';
  btn.disabled = true;

  try {
    const deleteInChunks = async snap => {
      for (let i = 0; i < snap.docs.length; i += 400) {
        const batch = db.batch();
        snap.docs.slice(i, i + 400).forEach(d => batch.delete(d.ref));
        await batch.commit();
      }
    };

    const [roomsSnap, coSnap, notifSnap] = await Promise.all([
      db.collection('rooms').get(),
      db.collection('checkouts').get(),
      db.collection('notifications').get(),
    ]);
    await deleteInChunks(roomsSnap);
    await deleteInChunks(coSnap);
    await deleteInChunks(notifSnap);
    await db.collection('meta').doc('lastUpload').delete().catch(() => {});

    toast('Dados do dia limpos. Faça o upload do novo Excel.', 'success', 6000);
    showTab('upload');
  } catch (err) {
    toast('Erro ao limpar dados: ' + err.message, 'error');
  } finally {
    btn.textContent = '🗑 Limpar Dados do Dia';
    btn.disabled = false;
  }
}

// ── Admin — Excel Upload ───────────────────────────────────────────────────
let parsedData = [];

function setupUpload() {
  const area = qs('#upload-area');
  const inp  = qs('#excel-file');
  area.addEventListener('click', () => inp.click());
  area.addEventListener('dragover',  e => { e.preventDefault(); area.classList.add('drag-over'); });
  area.addEventListener('dragleave', () => area.classList.remove('drag-over'));
  area.addEventListener('drop', e => { e.preventDefault(); area.classList.remove('drag-over'); const f = e.dataTransfer.files[0]; if (f) readExcel(f); });
  inp.addEventListener('change', () => { if (inp.files[0]) readExcel(inp.files[0]); inp.value = ''; });
}

function readExcel(file) {
  if (!/\.(xlsx|xls)$/i.test(file.name)) { toast('Selecione um arquivo .xlsx ou .xls', 'warning'); return; }
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const wb   = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
      const ws   = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json(ws, { defval: '' });
      if (!json.length) { toast('Arquivo vazio.', 'error'); return; }

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
  reader.readAsArrayBuffer(file);
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
          <td style="color:var(--${r.balance > 0 ? 'warn' : 'success'})">${R$(r.balance)}</td>
          <td>${r.debit   ? '✅' : '—'}</td>
          <td>${r.invoice ? '✅' : '—'}</td>
        </tr>`).join('')}
      </tbody>
    </table>
    ${data.length > 20 ? `<p style="padding:8px 16px;color:var(--text-dim);font-size:.8rem">… e mais ${data.length - 20} registros</p>` : ''}`;
  qs('#upload-preview').style.display = '';
  qs('#upload-area').style.display    = 'none';
  toast(`${data.length} registros. Confirme para importar.`, 'info');
}

async function confirmImport() {
  if (!parsedData.length) return;
  const btn = qs('#btn-confirm-upload');
  btn.textContent = 'Importando…';
  btn.disabled = true;

  const bar  = document.createElement('div'); bar.className = 'progress-bar-wrap';
  const fill = document.createElement('div'); fill.className = 'progress-bar'; fill.style.width = '0%';
  bar.appendChild(fill); btn.after(bar);

  try {
    // Step 1: delete all existing rooms (fresh start)
    fill.style.width = '5%';
    const existingSnap = await db.collection('rooms').get();
    for (let i = 0; i < existingSnap.docs.length; i += 400) {
      const batch = db.batch();
      existingSnap.docs.slice(i, i + 400).forEach(d => batch.delete(d.ref));
      await batch.commit();
    }
    fill.style.width = '20%';

    // Step 2: import all rows as new documents
    const total = parsedData.length;
    let done = 0;
    for (let i = 0; i < total; i += 400) {
      const batch = db.batch();
      const nowSV = SV();
      for (const row of parsedData.slice(i, i + 400)) {
        batch.set(db.collection('rooms').doc(), {
          rsv: row.rsv, guestName: row.guestName, roomNumber: row.roomNumber,
          balance: row.balance, debit: row.debit, invoice: row.invoice,
          status: 'active', checkoutTime: null, uploadedAt: nowSV, updatedAt: nowSV,
        });
        fill.style.width = `${20 + Math.round((++done / total) * 80)}%`;
      }
      await batch.commit();
    }
    await db.collection('meta').doc('lastUpload').set({
      uploadedAt: SV(), count: total, uploadedBy: state.user?.uid || 'unknown',
    });
    toast(`✅ ${total} reservas importadas!`, 'success');
    cancelImport();
    showTab('rooms');
  } catch (err) {
    toast('Erro na importação: ' + err.message, 'error');
  } finally {
    btn.textContent = 'Confirmar Upload';
    btn.disabled = false;
    bar.remove();
  }
}

function cancelImport() {
  parsedData = [];
  qs('#upload-preview').style.display = 'none';
  qs('#upload-area').style.display    = '';
  qs('#preview-table-container').innerHTML = '';
}

function subscribeUploadMeta() {
  if (state.uploadMetaUnsubscribe) state.uploadMetaUnsubscribe();
  state.uploadMetaUnsubscribe = db.collection('meta').doc('lastUpload')
    .onSnapshot(doc => {
      const card = qs('#last-upload-card');
      const info = qs('#last-upload-info');
      if (!card || !info) return;
      if (doc.exists) {
        const d = doc.data();
        info.innerHTML = `Último upload: <strong>${fmtDate(d.uploadedAt)}</strong> — <strong>${d.count}</strong> reservas`;
        card.style.display = '';
      } else {
        card.style.display = 'none';
      }
    }, console.error);
}

async function undoUpload() {
  if (!confirm('Remover todos os quartos do último upload?\nCheck-outs e comprovantes de pagamento são preservados.\n\nContinuar?')) return;

  const btn = qs('#btn-undo-upload');
  btn.textContent = 'Removendo…';
  btn.disabled = true;

  try {
    const snap = await db.collection('rooms').get();
    for (let i = 0; i < snap.docs.length; i += 400) {
      const batch = db.batch();
      snap.docs.slice(i, i + 400).forEach(d => batch.delete(d.ref));
      await batch.commit();
    }
    await db.collection('meta').doc('lastUpload').delete().catch(() => {});
    toast('Quartos removidos. Faça o upload do novo Excel.', 'success', 6000);
  } catch (err) {
    toast('Erro ao remover quartos: ' + err.message, 'error');
  } finally {
    btn.textContent = '🗑 Remover Quartos';
    btn.disabled = false;
  }
}

// ── Notifications ──────────────────────────────────────────────────────────
function subscribeNotifications() {
  if (state.notifUnsubscribe) state.notifUnsubscribe();
  state.notifUnsubscribe = db.collection('notifications').orderBy('createdAt', 'desc').limit(60)
    .onSnapshot(snap => {
      const notifs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const unread = notifs.filter(n => !n.read).length;
      qs('#notification-badge').textContent    = unread;
      qs('#notification-badge').style.display  = unread > 0 ? '' : 'none';
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
    <div class="notif-item ${n.read ? '' : 'unread'}" data-notif-id="${n.id}">
      <div class="notif-icon">${n.type === 'checkout' ? '🏨' : '💰'}</div>
      <div class="notif-text">
        <div class="notif-msg">${n.message}</div>
        <div class="notif-time">${fmtDate(n.createdAt)}</div>
      </div>
    </div>`).join('');

  list.querySelectorAll('.notif-item').forEach(el =>
    el.addEventListener('click', () => db.collection('notifications').doc(el.dataset.notifId).update({ read: true }).catch(() => {}))
  );
}

async function markAllRead() {
  const snap  = await db.collection('notifications').where('read', '==', false).get();
  const batch = db.batch();
  snap.docs.forEach(d => batch.update(d.ref, { read: true }));
  await batch.commit();
}

// ── Mercado Pago return ────────────────────────────────────────────────────
function handleMPReturn() {
  const p      = new URLSearchParams(window.location.search);
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
          state.cart = [];
          renderGuestBalance(state.foundRoom);
          qs('#products-section').style.display = '';
          renderProductsGuest(state.allProducts);
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
  // Nav logo → home
  qs('#nav-logo-btn').addEventListener('click', () => showView('guest-view'));

  // Language switcher
  qsa('.lang-btn').forEach(b => b.addEventListener('click', () => setLang(b.dataset.lang)));

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
  qs('#close-notifications').addEventListener('click', () => qs('#notification-panel').style.display = 'none');
  qs('#btn-mark-all-read').addEventListener('click', markAllRead);
  document.addEventListener('click', e => {
    const p = qs('#notification-panel'), b = qs('#btn-notifications');
    if (p && p.style.display !== 'none' && !p.contains(e.target) && !b.contains(e.target))
      p.style.display = 'none';
  });

  // Guest
  qs('#btn-search-guest').addEventListener('click', searchGuest);
  qs('#guest-room').addEventListener('keydown',  e => e.key === 'Enter' && searchGuest());
  qs('#guest-name').addEventListener('keydown',  e => e.key === 'Enter' && searchGuest());
  qs('#product-search').addEventListener('input', () => renderProductsGuest(state.allProducts));

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

  // Reception alert
  qs('#btn-back-from-reception').addEventListener('click', () => {
    qs('#reception-alert-view').style.display = 'none';
    qs('.guest-search-card').style.display = '';
    state.foundRoom = null;
  });
  qs('#btn-call-reception').addEventListener('click', () => {
    toast('Por favor, dirija-se ao balcão da recepção.', 'info', 6000);
  });

  // Guest receipt
  qs('#btn-guest-receipt').addEventListener('click', printGuestReceipt);

  // Guest success banner
  qs('#btn-new-checkout').addEventListener('click', resetGuestView);

  // Checkout
  qs('#btn-checkout').addEventListener('click', openCheckoutModal);
  qs('#btn-confirm-checkout').addEventListener('click', confirmCheckout);
  qs('#btn-cancel-checkout').addEventListener('click', () => qs('#checkout-modal').style.display = 'none');
  qs('#checkout-modal').addEventListener('click', e => {
    if (e.target === qs('#checkout-modal')) qs('#checkout-modal').style.display = 'none';
  });

  // Admin tabs
  qsa('.tab-btn').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));

  // Check-ins filters
  qs('#filter-checkin-name').addEventListener('input', () => renderCheckins(state.allRooms));
  qs('#filter-checkin-room').addEventListener('input', () => renderCheckins(state.allRooms));

  // Checkouts filters
  qs('#filter-room').addEventListener('input', () => renderCheckouts(state.allCheckouts));
  qs('#filter-date').addEventListener('change', () => renderCheckouts(state.allCheckouts));
  qs('#btn-export-excel').addEventListener('click', exportCheckoutsExcel);
  qs('#btn-clear-day').addEventListener('click', clearDayData);

  // Products admin
  qs('#filter-prod-admin').addEventListener('input', () => renderProductsAdmin(state.allProducts));
  qs('#btn-new-product').addEventListener('click', () => openProductModal(null));
  qs('#btn-save-product').addEventListener('click', saveProduct);
  qs('#btn-cancel-product').addEventListener('click', () => qs('#product-modal').style.display = 'none');
  qs('#btn-delete-product').addEventListener('click', deleteProduct);
  qs('#close-product-modal').addEventListener('click', () => qs('#product-modal').style.display = 'none');
  qs('#product-modal').addEventListener('click', e => {
    if (e.target === qs('#product-modal')) qs('#product-modal').style.display = 'none';
  });
  qs('#prod-image-file').addEventListener('change', e => {
    if (e.target.files[0]) handleProductImageUpload(e.target.files[0]);
  });
  qs('#prod-image-url').addEventListener('input', e => {
    const url = e.target.value.trim();
    qs('#prod-image-preview').src = url;
    qs('#prod-image-preview-wrap').style.display = url ? '' : 'none';
  });

  // Rooms filters
  qs('#filter-rooms-text').addEventListener('input',  () => renderRoomsGrid(state.allRooms));
  qs('#sort-rooms').addEventListener('change',        () => renderRoomsGrid(state.allRooms));

  // Room edit modal
  qs('#btn-save-room-edit').addEventListener('click', saveRoomEdit);
  qs('#btn-cancel-room-edit').addEventListener('click', () => qs('#room-edit-modal').style.display = 'none');
  qs('#close-room-edit-modal').addEventListener('click', () => qs('#room-edit-modal').style.display = 'none');
  qs('#room-edit-modal').addEventListener('click', e => {
    if (e.target === qs('#room-edit-modal')) qs('#room-edit-modal').style.display = 'none';
  });
  qs('#room-edit-category-chips').addEventListener('click', e => {
    const chip = e.target.closest('.chip-btn');
    if (!chip) return;
    qs('#room-edit-category-chips').querySelectorAll('.chip-btn').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
  });

  // Payments
  qs('#filter-payment').addEventListener('input',         () => renderPayments(state.allPayments));
  qs('#filter-payment-status').addEventListener('change', () => renderPayments(state.allPayments));
  qs('#filter-payment-method').addEventListener('change', () => renderPayments(state.allPayments));

  // History
  qs('#filter-history').addEventListener('input',      () => renderHistory(state.allHistory));
  qs('#filter-history-from').addEventListener('change', () => renderHistory(state.allHistory));
  qs('#filter-history-to').addEventListener('change',   () => renderHistory(state.allHistory));
  qs('#btn-export-history').addEventListener('click', exportHistoryExcel);

  // Upload
  setupUpload();
  qs('#btn-confirm-upload').addEventListener('click', confirmImport);
  qs('#btn-cancel-upload').addEventListener('click', cancelImport);
  qs('#btn-undo-upload').addEventListener('click', undoUpload);
}

// ── Bootstrap ──────────────────────────────────────────────────────────────
(function () {
  handleMPReturn();
  bindEvents();
  showView('guest-view');
  subscribeProductsGlobal();
  // Apply saved language and mark active lang button
  setLang(currentLang);
  // Clear guest form after browser autofill has a chance to fire
  setTimeout(() => {
    const gn = qs('#guest-name'); if (gn) gn.value = '';
    const gr = qs('#guest-room'); if (gr) gr.value = '';
  }, 400);
})();
