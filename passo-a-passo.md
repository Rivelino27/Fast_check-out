# Fast Check-Out Hotel — Guia Completo de Configuração

## 1. Pré-requisitos

- Node.js 18+ instalado
- Firebase CLI: `npm install -g firebase-tools`
- Conta no [Firebase](https://console.firebase.google.com)
- Conta no [Mercado Pago](https://www.mercadopago.com.br) (use login do Mercado Livre)

---

## 2. Configuração do Firebase

### 2.1 Criar o Projeto

1. Acesse [console.firebase.google.com](https://console.firebase.google.com)
2. **Adicionar projeto** → Nome: `fast-checkout-hotel` → Criar

### 2.2 Ativar Authentication

1. **Authentication** → **Começar**
2. Aba **Sign-in method** → habilitar **E-mail/senha**

### 2.3 Configurar Firestore

1. **Firestore Database** → **Criar banco de dados**
2. **Modo de produção** → Localização: `southamerica-east1` (São Paulo)

### 2.4 Configurar Storage

1. **Storage** → **Começar** → Localização: `southamerica-east1`

### 2.5 Obter credenciais do app web

1. **Visão geral** → ícone `</>` (Web) → Registrar app
2. Copie o objeto `firebaseConfig` e cole em `public/js/config.js`

---

## 3. Criar Usuário Administrador

### 3.1 Criar usuário

1. **Authentication** → **Users** → **Adicionar usuário**
2. Informe e-mail e senha → **Copie o UID** gerado

### 3.2 Criar documento na coleção /admins

1. **Firestore** → **Iniciar coleção** → Nome: `admins`
2. **Document ID** = o UID copiado
3. Campo: `email` (string) = e-mail do admin

### 3.3 Super Admin (gerencia produtos)

Para um admin ter acesso ao CRUD de produtos, abra o documento em `admins/{uid}` e adicione:

- Campo: `superAdmin` (boolean) = `true`

Admins sem `superAdmin: true` veem os produtos mas não editam.

---

## 4. Configuração do Mercado Pago

### 4.1 Criar aplicativo

1. Acesse [mercadopago.com.br](https://www.mercadopago.com.br) → login
2. Menu: **Seu negócio** → **Configurações** → **Suas integrações**
3. **Criar aplicativo** → Nome: `Fast Check-Out Hotel`
4. Marque **CheckoutPro** e **Pagamentos transparentes** → Salvar

### 4.2 Obter credenciais de produção (PIX e Cartão)

Na página do aplicativo → **Credenciais de produção**:

| Chave | Onde usar |
|-------|-----------|
| **Public Key** (`APP_USR-...`) | `public/js/config.js` (front-end) |
| **Access Token** (`APP_USR-...`) | Firebase Functions config (back-end) |

> ⚠️ Nunca coloque o Access Token no código front-end.

### 4.3 Credenciais de teste (Sandbox)

Para testes sem cobranças reais, use **Credenciais de teste** (mesma tela).

---

## 5. Configurar credenciais no Firebase Functions

### 5.1 Login e seleção do projeto

```bash
firebase login
firebase use fast-checkout-hotel
```

### 5.2 Definir variáveis de ambiente

```bash
firebase functions:config:set \
  mercadopago.access_token="APP_USR-SEU-ACCESS-TOKEN" \
  mercadopago.public_key="APP_USR-SUA-PUBLIC-KEY" \
  app.site_url="https://fast-checkout-hotel.web.app"
```

Para **testes (sandbox)**:
```bash
firebase functions:config:set \
  mercadopago.access_token="TEST-SEU-TOKEN-TESTE" \
  mercadopago.public_key="TEST-SUA-PUBLIC-KEY-TESTE" \
  app.site_url="https://fast-checkout-hotel.web.app"
```

### 5.3 Atualizar config.js

Em `public/js/config.js`:
```javascript
const MERCADO_PAGO_PUBLIC_KEY = "APP_USR-SUA-PUBLIC-KEY";
```

---

## 6. Deploy

```bash
# Instalar dependências das Functions
cd functions
npm install
cd ..

# Deploy completo
firebase deploy
```

Após o deploy, anote a URL do webhook que aparece no terminal:
```
https://us-central1-fast-checkout-hotel.cloudfunctions.net/mercadoPagoWebhook
```

---

## 7. Configurar Webhook do Mercado Pago

O webhook é essencial — é ele que confirma automaticamente o PIX ao sistema.

### 7.1 Configurar no painel do MP

1. **Mercadopago.com.br** → Menu: **Configurações** → **Notificações** → **Webhooks**
2. **Configurar notificações**
3. URL de produção:
   ```
   https://us-central1-fast-checkout-hotel.cloudfunctions.net/mercadoPagoWebhook
   ```
4. Evento: ✅ **Pagamentos** (`payment`)
5. Salvar

### 7.2 Testar

Use **Simular evento** no painel do MP para validar que o webhook responde com HTTP 200.

---

## 8. Testar Pagamentos

### 8.1 PIX — Sandbox

Com credenciais de teste, o QR Code gerado é fictício. Para simular uma confirmação:
1. No painel do MP → **Atividade** → encontre o pagamento de teste
2. Use **Simular evento de pagamento** → status `approved`

### 8.2 Cartão de Crédito — Cartões de teste

| Bandeira | Número              | CVV | Validade |
|----------|---------------------|-----|----------|
| Visa     | 4235 6477 2802 5682 | 123 | 11/25    |
| Mastercard | 5031 4332 1540 6351 | 123 | 11/25  |
| Amex     | 3753 651535 56885   | 123 | 1234     |

- **CPF**: 12345678909
- **Nome no cartão**: `APRO` (aprova automaticamente)

---

## 9. Cadastrar Produtos (Super Admin)

1. Faça login no site com conta super admin
2. **Dashboard → Produtos → + Novo Produto**
3. Preencha nome, descrição, preço
4. Faça upload de imagem (até 2MB) ou cole uma URL
5. Marque **Produto disponível** → Salvar

Hóspedes verão o catálogo ao consultar seu quarto e poderão adicionar itens ao carrinho.

---

## 10. Fluxo Completo

```
[ADMIN] Upload Excel com reservas
    → Quartos criados no Firestore em tempo real

[HÓSPEDE no mobile] Consulta nome + quarto
    → Vê saldo devedor e catálogo de produtos
    → Adiciona itens ao carrinho
    → Paga via PIX (QR Code) ou Cartão/Google Pay
        → Webhook MP notifica o servidor
        → App detecta via onSnapshot (sem reload)
        → Saldo zerado automaticamente
    → Hóspede realiza check-out

[ADMIN] Recebe notificação em tempo real (sem reload)
    → Vê check-out na lista filtrada
```

---

## 11. Coleções do Firestore

| Coleção | Descrição |
|---------|-----------|
| `/admins/{uid}` | Admins. `superAdmin: true` = acesso ao CRUD de produtos |
| `/rooms/{id}` | Reservas importadas via Excel |
| `/products/{id}` | Cardápio de produtos gerenciados pelo super admin |
| `/payments/{id}` | Pagamentos PIX e cartão |
| `/checkouts/{id}` | Histórico de check-outs |
| `/notifications/{id}` | Notificações em tempo real para admins |

---

## 12. Dúvidas frequentes

**"Usuário não é administrador"**
→ O documento `/admins/{uid}` não existe ou o UID está errado. Verifique no Firebase Console.

**PIX não confirma automaticamente**
→ Verifique se o webhook está configurado. Use Access Token de produção, não teste.

**Erro ao fazer deploy**
→ Execute `cd functions && npm install` antes de `firebase deploy`.

**Como adicionar mais admins?**
→ Crie o usuário em Authentication, copie o UID e crie o documento em `/admins/{uid}`.

**Como mudar o nome do hotel?**
→ Edite `public/index.html`, elemento com `class="nav-logo-text"`.
