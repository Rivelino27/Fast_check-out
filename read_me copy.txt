# Passo a Passo — Fast Check-Out Hotel
Próximos passos essenciais
Leia o passo-a-passo.md — tem tudo detalhado com comandos exatos
Crie o projeto Firebase e copie o firebaseConfig para js/config.js
Crie conta Mercado Pago (usa login do Mercado Livre) → pegue Access Token e Public Key
Execute firebase init + firebase deploy
Configure o webhook do Mercado Pago com a URL das suas Functions
Sobre os custos (resposta à sua pergunta)
Firebase: plano Blaze necessário para Functions (mas as primeiras 2 milhões de chamadas/mês são grátis)
Mercado Pago: setup gratuito, paga só por transação — PIX ~0,99%, cartão ~2,99-4,99% — sem mensalidade

npm install -g firebase-tools
firebase login
firebase init
firebase deploy

cd functions
npm install
cd ..
firebase deploy

cd functions && npm install && cd ..
cd functions ; npm install ; cd ..
cd functions ; npm install ; cd .. ; firebase deploy
firebase deploy

Pressione Ctrl + Shift + R (Windows) ou Cmd + Shift + R (Mac) para forçar o reload sem cache.

## Visão Geral do Sistema

- **Frontend**: HTML + CSS (neon/glassmorphism) + JavaScript vanilla
- **Backend**: Firebase (Firestore, Auth, Storage, Functions, Hosting)
- **Pagamentos**: Mercado Pago (PIX com QR Code + Cartão/Google Pay)
- **Tempo real**: Firestore `onSnapshot` — sem reload de página

---

## Serviços Firebase Necessários

| Serviço | Função |
|---|---|
| **Firestore** | Banco de dados em tempo real (quartos, pagamentos, notificações, checkouts) |
| **Authentication** | Login dos administradores (email/senha) |
| **Storage** | Upload dos arquivos Excel (opcional — o parse é feito no browser) |
| **Functions** | Integração com Mercado Pago (PIX + cartão) — mantém credenciais seguras |
| **Hosting** | Publicar o site com HTTPS (obrigatório para webhooks e Google Pay) |

---

## PASSO 1 — Criar Projeto no Firebase

1. Acesse [console.firebase.google.com](https://console.firebase.google.com)
2. Clique em **"Adicionar projeto"**
3. Nome sugerido: `fast-checkout-hotel`
4. Desative o Google Analytics (opcional)
5. Clique em **Criar projeto**

---

## PASSO 2 — Adicionar Aplicativo Web

1. No painel do projeto, clique no ícone **`</>`** (Web)
2. Nome do app: `fast-checkout-web`
3. Marque **"Também configurar Firebase Hosting"**
4. Clique em **Registrar app**
5. Copie o objeto `firebaseConfig` — você vai colar em `js/config.js`

---

## PASSO 3 — Ativar os Serviços

### 3.1 Firestore Database
1. Menu lateral → **Firestore Database**
2. Clique **"Criar banco de dados"**
3. Selecione **"Iniciar no modo de produção"**
4. Escolha a região: **`southamerica-east1`** (São Paulo — menor latência no Brasil)
5. Clique em **Ativar**

### 3.2 Authentication
1. Menu lateral → **Authentication**
2. Clique **"Começar"**
3. Na aba **"Sign-in method"**, habilite **"E-mail/senha"**
4. Clique em **Salvar**

### 3.3 Storage
1. Menu lateral → **Storage**
2. Clique **"Começar"**
3. Inicie no modo de produção
4. Região: `southamerica-east1`

### 3.4 Functions
1. Menu lateral → **Functions**
2. Clique **"Começar"** (requer plano Blaze — pago por uso)
3. O plano gratuito tem limite; para produção, o Blaze é necessário

> **Custo estimado Functions**: primeiras 2 milhões de invocações/mês são grátis no plano Blaze.

---

## PASSO 4 — Firebase CLI (Linha de Comando)

### Instalar o Firebase CLI
```bash
npm install -g firebase-tools
```

### Login
```bash
firebase login
```

### Inicializar o projeto (na pasta do site)
```bash
cd "e:\DOCS\LINGUAGENS\sites html e css\Fast_check-out"
firebase init
```

Selecione com `Espaço`:
- ✅ Firestore
- ✅ Functions
- ✅ Hosting
- ✅ Storage

Configurações sugeridas:
- Project: selecione o projeto criado
- Firestore Rules: `firestore.rules`
- Firestore Indexes: `firestore.indexes.json`
- Functions language: **JavaScript**
- Use ESLint: **N**
- Install dependencies: **Y**
- Hosting public dir: **`.`** (ponto — raiz do projeto)
- Single-page app: **Y**
- Storage rules: `storage.rules`

---

## PASSO 5 — Mercado Pago

### 5.1 Criar conta / usar conta existente
- Acesse [mercadopago.com.br](https://www.mercadopago.com.br)
- Se já tem conta no Mercado Livre, pode usar o mesmo login
- Na conta Mercado Pago, acesse **Seu negócio → Configurações**

### 5.2 Obter credenciais
1. Acesse: [mercadopago.com.br/settings/account/credentials](https://www.mercadopago.com.br/settings/account/credentials)
2. Copie:
   - **`Access Token`** de produção (começa com `APP_USR-...`)
   - **`Public Key`** de produção (começa com `APP_USR-...`)
3. Para testes, use as credenciais de **Sandbox/Teste**

### 5.3 Taxas do Mercado Pago (gratuito pra configurar)
| Método | Taxa por transação |
|---|---|
| PIX | ~0,99% |
| Cartão de crédito | ~2,99% a 4,99% |
| Google Pay | ~2,99% |
> Não há mensalidade. Você paga apenas quando recebe.

### 5.4 Configurar webhook no Mercado Pago
1. Acesse [mercadopago.com.br/developers/pt/docs/notifications](https://www.mercadopago.com.br/developers/pt/docs/notifications)
2. Após o deploy das Functions, você terá uma URL tipo:
   `https://us-central1-SEU_PROJETO.cloudfunctions.net/mercadoPagoWebhook`
3. Cadastre essa URL no painel do Mercado Pago em **Notificações → Webhooks**
4. Selecione o evento: **`payment`**

---

## PASSO 6 — Configurar Credenciais nas Functions

Após o `firebase init`, dentro da pasta `functions/`:

```bash
cd functions
npm install
```

Defina as variáveis de ambiente (credenciais ficam seguras no servidor):
```bash
firebase functions:config:set mercadopago.access_token="SEU_ACCESS_TOKEN_AQUI"
firebase functions:config:set mercadopago.public_key="SUA_PUBLIC_KEY_AQUI"
firebase functions:config:set app.site_url="https://SEU_PROJETO.web.app"
```

---

## PASSO 7 — Deploy das Regras Firestore

O arquivo `firestore.rules` já está configurado. Para aplicar:
```bash
firebase deploy --only firestore:rules
```

### Estrutura das Regras:
```
/rooms        → leitura pública | escrita só admin
/payments     → leitura pública | criação pública | update só Functions
/checkouts    → leitura pública | criação pública | update só admin
/notifications → leitura só admin | criação pública/Functions
/admins       → leitura só admin | escrita nunca (só console)
```

---

## PASSO 8 — Criar Primeiro Admin

1. No Firebase Console → **Authentication** → **Usuários**
2. Clique **"Adicionar usuário"**
3. Preencha e-mail e senha do administrador
4. Copie o **UID** gerado (coluna "User UID")
5. Vá em **Firestore** → **Iniciar coleção** → nome: `admins`
6. ID do documento: **cole o UID** do usuário
7. Adicione os campos:
   - `email` (string): `admin@seuhotel.com`
   - `name` (string): `Administrador`
   - `createdAt` (timestamp): (clique em "timestamp" e selecione data atual)

> Para adicionar mais admins, repita o processo com outros usuários.

---

## PASSO 9 — Configurar o `js/config.js`

Abra o arquivo `js/config.js` e substitua os valores com os do seu projeto Firebase e Mercado Pago:

```javascript
const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "fast-checkout-hotel.firebaseapp.com",
  projectId: "fast-checkout-hotel",
  storageBucket: "fast-checkout-hotel.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abc123"
};

const MERCADO_PAGO_PUBLIC_KEY = "APP_USR-sua-public-key-aqui";
```

---

## PASSO 10 — Deploy Final

```bash
# Da pasta raiz do projeto
firebase deploy
```

Isso vai:
1. Fazer deploy das Cloud Functions (Mercado Pago)
2. Publicar as regras Firestore e Storage
3. Publicar o site no Firebase Hosting

Acesse seu site em: `https://SEU_PROJETO.web.app`

---

## Estrutura do Excel para Upload

| RSV | NOME | QUARTO | SALDO | DEBITAR | FATURAR |
|---|---|---|---|---|---|
| 10234 | João Silva | 101 | 150.00 | Sim | Não |
| 10235 | Maria Santos | 102 | 0.00 | Sim | Sim |
| 10236 | Pedro Costa | 103 | 80.50 | Não | Sim |

> **Observações:**
> - A primeira linha deve ser o cabeçalho (nome das colunas)
> - Colunas aceitam: `Sim`/`Não`, `sim`/`não`, `S`/`N`, `true`/`false`, `1`/`0`
> - Saldo em reais (use ponto ou vírgula como decimal)
> - Quartos já existentes serão **atualizados**, novos serão **criados**

---

## Índices Firestore

O arquivo `firestore.indexes.json` cria os índices necessários para:
- Busca de quartos ativos por número
- Listagem de checkouts por horário
- Notificações não lidas por data

Para criar os índices:
```bash
firebase deploy --only firestore:indexes
```

---

## Estrutura de Coleções Firestore

```
/rooms/{roomId}
  rsv: string
  guestName: string
  roomNumber: string
  balance: number
  debit: boolean
  invoice: boolean
  status: "active" | "checked-out"
  checkoutTime: timestamp | null
  uploadedAt: timestamp
  updatedAt: timestamp

/checkouts/{checkoutId}
  roomId: string
  rsv: string
  roomNumber: string
  guestName: string
  finalBalance: number
  checkoutTime: timestamp
  checkedOutBy: "guest" | "admin"
  adminUid: string | null

/payments/{paymentId}
  roomId: string
  roomNumber: string
  guestName: string
  amount: number
  items: array[{name, price}]
  method: "pix" | "credit_card"
  status: "pending" | "approved" | "rejected"
  mercadoPagoId: string
  pixCode: string
  pixCodeBase64: string
  preferenceId: string
  createdAt: timestamp
  updatedAt: timestamp

/notifications/{notificationId}
  type: "checkout" | "payment"
  message: string
  roomNumber: string
  roomId: string
  amount: number | null
  method: string | null
  read: boolean
  createdAt: timestamp

/admins/{uid}
  email: string
  name: string
  createdAt: timestamp
```

---

## Testar Pagamento PIX em Sandbox

1. No Mercado Pago, use credenciais de **teste** no `config.js`
2. Gere um QR Code de teste
3. Use o app **Mercado Pago Sandbox** ou simule o pagamento via API:
```bash
curl -X POST "https://api.mercadopago.com/v1/payments/TEST_PAYMENT_ID/simulate_payment" \
  -H "Authorization: Bearer TEST_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status": "approved"}'
```

---

## Checklist Final antes de ir para Produção

- [ ] `js/config.js` com credenciais Firebase de produção
- [ ] Credenciais Mercado Pago de **produção** nas Functions config
- [ ] Webhook Mercado Pago apontando para a URL das Functions
- [ ] Pelo menos 1 admin criado no Firebase Auth + Firestore
- [ ] `firebase deploy` executado com sucesso
- [ ] Site acessível via HTTPS (`https://SEU_PROJETO.web.app`)
- [ ] Testar busca de quarto como hóspede
- [ ] Testar upload de Excel como admin
- [ ] Testar geração de PIX
- [ ] Testar checkout e notificação em tempo real

Sobre configuração do Mercado Pago: a Access Token de produção (APP_USR-...) está correta. Para o PIX funcionar em produção precisa verificar no painel 
MP se: (1) a conta está com identidade verificada (KYC completo), (2) existe uma chave PIX cadastrada na conta MP, e (3) o webhook está configurado com a 
URL  https://us-central1-fast-checkout-hotel.cloudfunctions.net/mercadoPagoWebhook com evento "Pagamentos" selecionado.

---

Passo a passo — Cartão de Crédito e Google Pay
O PIX já funciona, então sua conta MP e o Access Token já estão configurados. Os passos abaixo são apenas para habilitar o Checkout Pro (cartão/Google Pay).

Passo 1 — Habilitar o Checkout Pro na sua aplicação MP
Acesse mercadopago.com.br/developers/panel/app
Clique na sua aplicação Fast Check-Out Hotel (ou crie uma se não tiver)
Na aba "Checkout Pro" → verifique se está habilitado
Em "Meios de pagamento" confirme que Cartão de crédito, Cartão de débito e Google Pay estão marcados
Passo 2 — Registrar a URL do Webhook
Na sua aplicação MP → aba "Notificações IPN / Webhooks":

URL do Webhook:

https://mercadopagowebhook-5fa5s6ykhq-uc.a.run.app
Evento a ativar: payment ✓
Clique em Salvar
⚠️ Essa URL também recebe as notificações do PIX. Se você já tinha um webhook cadastrado com a URL antiga (cloudfunctions.net/...), substitua por esta nova.

Passo 3 — Testar em Sandbox primeiro
Na sua aplicação MP mude temporariamente para credenciais de teste (TEST-...) e no Firebase:


firebase functions:secrets:set MP_ACCESS_TOKEN
# Cole o token de TESTE quando pedir
firebase deploy --only functions
Cards de teste estão em: mercadopago.com.br/developers/pt/docs/checkout-pro/additional-content/test-cards

Números para simular:

Cartão	Número	CVV	Resultado
Visa aprovado	4235 6477 2802 5682	qualquer 3 dig.	Aprovado
Mastercard recusado	5031 7557 3453 0604	qualquer	Recusado
Passo 4 — Ativar produção
Quando os testes passarem:


firebase functions:secrets:set MP_ACCESS_TOKEN
# Cole o Access Token de PRODUÇÃO (APP_USR-...)
firebase deploy --only functions
Como funciona o fluxo completo

Hóspede clica "Cartão / Google Pay"
       ↓
createCardPreference (Firebase Function)
       ↓
Redireciona para checkout.mercadopago.com.br
       ↓
Hóspede paga com cartão ou Google Pay
       ↓
MP dispara webhook → mercadoPagoWebhook (Firebase Function)
       ↓
Firestore: saldo = 0 + notificação admin
       ↓
MP redireciona de volta: ?payment=success&roomId=...
       ↓
Site mostra saldo zerado em tempo real → hóspede faz check-out
Google Pay aparece automaticamente no checkout MP quando o hóspede está em Android ou Chrome desktop com um cartão cadastrado no Google. 
Não requer nenhuma configuração extra da sua parte.

Solução: criar nova aplicação MP com Checkout Pro
Passo 1 — Criar a nova aplicação
Acesse: mercadopago.com.br/developers/panel/app
Clique em "Criar aplicação" (botão azul no canto)
Preencha:
Nome: Fast Check-Out Hotel
Para que você vai usar? → Pagamentos online
Integração: → selecione "Checkout Pro" ← importante
Clique em Salvar
Passo 2 — Pegar o novo Access Token
Dentro da nova aplicação → aba "Credenciais"

Você verá dois tokens — pegue o Access Token (não a Public Key):


Produção:  APP_USR-1234567890-...  ← esse
Teste:     TEST-1234567890-...     ← ou esse para testar
Passo 3 — Atualizar o segredo no Firebase
Abra o terminal na pasta do projeto e rode:


firebase functions:secrets:set MP_ACCESS_TOKEN
Quando aparecer ? Enter a value for MP_ACCESS_TOKEN: — cole o novo token e Enter.

O novo token funciona para PIX e cartão ao mesmo tempo — não precisa mudar mais nada no código.

Passo 4 — Redeploy

firebase deploy --only functions
 
----