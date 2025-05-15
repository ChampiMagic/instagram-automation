const express = require('express');
const axios = require('axios');
const dotenv = require('dotenv');
const cors = require('cors');

dotenv.config();

//TODO: Verificar que se esta obteniendo un token de larga duracionn

const app = express();
app.use(express.json());
//app.use(cors({ origin: 'http://localhost:3001' })); // Ajusta el origen según el puerto del frontend
app.use(cors({ origin: 'https://instagram-automation-setters.vercel.app' })); // Ajusta el origen según el puerto del frontend

const IG_APP_ID = process.env.IG_APP_ID;
const IG_APP_SECRET = process.env.IG_APP_SECRET;
const IG_REDIRECT_URI = process.env.IG_REDIRECT_URI;
const IG_VERIFY_TOKEN = process.env.IG_VERIFY_TOKEN;

// Token storage structure
let tokenData = {
  accessToken: null,
  longLivedToken: null,
  tokenExpiry: null,
  instagramScopeID: null,
  pageId: null,
  pageAccessToken: null
};

// Function to exchange short-lived token for long-lived token
async function exchangeForLongLivedToken(shortLivedToken) {
  try {
    const response = await axios.get('https://graph.facebook.com/v22.0/oauth/access_token', {
      params: {
        grant_type: 'fb_exchange_token',
        client_id: IG_APP_ID,
        client_secret: IG_APP_SECRET,
        fb_exchange_token: shortLivedToken
      }
    });

    const { access_token, expires_in } = response.data;
    const expiryDate = new Date();
    expiryDate.setSeconds(expiryDate.getSeconds() + expires_in);

    return {
      token: access_token,
      expiry: expiryDate
    };
  } catch (error) {
    console.error('Error exchanging token:', error.response ? error.response.data : error.message);
    throw error;
  }
}

// Function to check if token needs renewal
function shouldRenewToken() {
  if (!tokenData.tokenExpiry) return true;
  
  const now = new Date();
  const daysUntilExpiry = (tokenData.tokenExpiry - now) / (1000 * 60 * 60 * 24);
  
  // Renew if less than 7 days until expiry
  return daysUntilExpiry < 7;
}

// Endpoint para procesar el token de acceso desde el frontend
app.post('/auth/token', async (req, res) => {
  const { accessToken: clientAccessToken } = req.body;
  if (!clientAccessToken) {
    return res.status(400).json({ error: 'Token de acceso no proporcionado' });
  }

  try {
    // Exchange for long-lived token
    const { token: longLivedToken, expiry } = await exchangeForLongLivedToken(clientAccessToken);
    
    // Obtener información del usuario con el token
    const userResponse = await axios.get('https://graph.facebook.com/v22.0/me', {
      params: {
        access_token: longLivedToken,
        fields: 'id,name',
      },
    });

    // Obtener cuentas de Instagram Business asociadas
    const igResponse = await axios.get('https://graph.facebook.com/v22.0/me/accounts', {
      params: {
        access_token: longLivedToken,
        fields: 'instagram_business_account{id,username},access_token',
      },
    });

    const instagramAccount = igResponse.data.data.find(page => page.instagram_business_account);
    if (!instagramAccount) {
      return res.status(400).json({ error: 'No se encontró una cuenta de Instagram Business vinculada', page: igResponse.data });
    }

    // Update token data
    tokenData = {
      accessToken: clientAccessToken,
      longLivedToken,
      tokenExpiry: expiry,
      instagramScopeID: instagramAccount.instagram_business_account.id,
      pageId: instagramAccount.id,
      pageAccessToken: instagramAccount.access_token
    };

    res.json({
      message: 'Cuenta conectada con éxito',
      instagramScopeID: tokenData.instagramScopeID,
      username: instagramAccount.instagram_business_account.username,
      tokenExpiry: tokenData.tokenExpiry
    });

  } catch (error) {
    console.error('Error en autenticación:', error.response ? error.response.data : error.message);
    res.status(500).json({ error: 'Error al conectar la cuenta' });
  }
});

// Verificación de Webhook
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  console.log("Verificando webhook");

  if (mode === 'subscribe' && token === IG_VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.status(403).send('Verificación fallida');
  }
});

// Procesamiento de Webhooks
app.post('/webhook', async (req, res) => {
  try {
    const data = req.body;

    console.debug('data', data);

    if (data.entry && data.entry[0]) {
      // Procesar comentarios
      if (data.entry[0].changes && data.entry[0].changes[0].value.text) {
        const comment = data.entry[0].changes[0].value.text.toLowerCase();
        const userId = data.entry[0].changes[0].value.from.id;

        if (comment.includes('quiero')) {
          await sendMessage(userId, 'Obten tu descuento desde aquí!');
        }
      }

      // Procesar mensajes directos
      if (data.entry[0].messaging && data.entry[0].messaging[0].message) {
        const message = data.entry[0].messaging[0].message.text.toLowerCase();
        const userId = data.entry[0].messaging[0].sender.id;

        if (message.includes('promo')) {
          await sendMessage(userId, 'Aquí está tu promoción!');
        }
      }
    }

    res.status(200).send('Evento procesado');
  } catch (error) {
    console.error('Error procesando webhook:', error.message);
    res.status(500).send('Error procesando evento');
  }
});

// Función para enviar mensajes
async function sendMessage(recipientId, message) {
  if (!tokenData.pageAccessToken || !tokenData.pageId) {
    console.error('No se ha autenticado la cuenta o no se encontró la página de Facebook');
    return;
  }

  // Check if token needs renewal
  if (shouldRenewToken()) {
    try {
      const { token: newToken, expiry } = await exchangeForLongLivedToken(tokenData.accessToken);
      tokenData.longLivedToken = newToken;
      tokenData.tokenExpiry = expiry;
    } catch (error) {
      console.error('Error renewing token:', error);
      // Continue with existing token if renewal fails
    }
  }

  try {
    await axios.post(
      'https://graph.facebook.com/v22.0/me/messages',
      {
        recipient: { id: recipientId },
        message: { text: message },
      },
      {
        params: {
          access_token: tokenData.pageAccessToken,
        },
      }
    );
    console.log('Mensaje enviado:', message);
  } catch (error) {
    console.error('Error enviando mensaje:', error.response ? error.response.data : error.message);
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en el puerto ${PORT}`);
});