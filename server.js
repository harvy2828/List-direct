const express = require('express');
const path = require('path');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

const app = express();
app.use(express.json());
app.use(express.static(__dirname));

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ── Claude AI proxy ──────────────────────────────────────────
app.post('/api/claude', async (req, res) => {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'API key not set' });
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: req.body.model || 'claude-haiku-4-5-20251001',
        max_tokens: req.body.max_tokens || 1000,
        system: req.body.system,
        messages: req.body.messages,
      }),
    });
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Auth: Sign Up ─────────────────────────────────────────────
app.post('/api/auth/signup', async (req, res) => {
  const { email, password, full_name, role } = req.body;
  try {
    const { data, error } = await supabase.auth.signUp({
      email, password,
      options: { data: { full_name, role: role || 'buyer' } }
    });
    if (error) return res.status(400).json({ error: error.message });
    res.json({ user: data.user, session: data.session });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Auth: Sign In ─────────────────────────────────────────────
app.post('/api/auth/signin', async (req, res) => {
  const { email, password } = req.body;
  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return res.status(400).json({ error: error.message });
    res.json({ user: data.user, session: data.session });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Auth: Sign Out ────────────────────────────────────────────
app.post('/api/auth/signout', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token) {
    const userSupabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } }
    });
    await userSupabase.auth.signOut();
  }
  res.json({ success: true });
});

// ── Auth: Get current user ────────────────────────────────────
app.get('/api/auth/me', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return res.status(401).json({ error: 'Invalid token' });
    const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single();
    res.json({ user, profile });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Listings: Create ──────────────────────────────────────────
app.post('/api/listings', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const { data: { user } } = await supabase.auth.getUser(token);
    if (!user) return res.status(401).json({ error: 'Invalid token' });
    const listing = { ...req.body, user_id: user.id, status: 'active' };
    const { data, error } = await supabase.from('listings').insert([listing]).select().single();
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Listings: Get user's listings ─────────────────────────────
app.get('/api/listings/mine', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const { data: { user } } = await supabase.auth.getUser(token);
    if (!user) return res.status(401).json({ error: 'Invalid token' });
    const { data, error } = await supabase.from('listings').select('*').eq('user_id', user.id).order('created_at', { ascending: false });
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Photos: Upload ────────────────────────────────────────────
app.post('/api/photos/upload', upload.single('photo'), async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const { data: { user } } = await supabase.auth.getUser(token);
    if (!user) return res.status(401).json({ error: 'Invalid token' });
    const file = req.file;
    const fileName = `${user.id}/${Date.now()}-${file.originalname}`;
    const { data, error } = await supabase.storage.from('listing-photos').upload(fileName, file.buffer, {
      contentType: file.mimetype, upsert: false
    });
    if (error) return res.status(400).json({ error: error.message });
    const { data: { publicUrl } } = supabase.storage.from('listing-photos').getPublicUrl(fileName);
    res.json({ url: publicUrl, path: fileName });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Favorites ─────────────────────────────────────────────────
app.post('/api/favorites', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const { data: { user } } = await supabase.auth.getUser(token);
    const { listing_id } = req.body;
    const { data, error } = await supabase.from('favorites').upsert([{ user_id: user.id, listing_id }]).select();
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/favorites', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const { data: { user } } = await supabase.auth.getUser(token);
    const { data, error } = await supabase.from('favorites').select('*').eq('user_id', user.id);
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ── Auth: Reset Password (send email) ────────────────────────
app.post('/api/auth/reset-password', async (req, res) => {
  const { email, redirectTo } = req.body;
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: redirectTo || process.env.SITE_URL + '/dashboard.html'
    });
    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Auth: Update Password ─────────────────────────────────────
app.post('/api/auth/update-password', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const { password } = req.body;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const userSupabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } }
    });
    const { error } = await userSupabase.auth.updateUser({ password });
    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ── Get Certified Agents ──────────────────────────────────────
app.get('/api/agents', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('role', 'agent')
      .eq('approved', true)
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ agents: data || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ── Admin: Get All Agents ─────────────────────────────────────
app.get('/api/admin/agents', async (req, res) => {
  const adminKey = req.headers['x-admin-key'];
  if (adminKey !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    // Get all agent profiles with their auth email
    const { data: profiles, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('role', 'agent')
      .order('created_at', { ascending: false });
    if (error) throw error;

    // Get emails from auth.users
    const { data: authData } = await supabase.auth.admin.listUsers();
    const userMap = {};
    if (authData?.users) {
      authData.users.forEach(u => { userMap[u.id] = u.email; });
    }

    const agents = (profiles || []).map(p => ({
      ...p,
      email: userMap[p.id] || p.email || '—'
    }));

    res.json({ agents });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Admin: Update Agent ───────────────────────────────────────
app.patch('/api/admin/agents/:id', async (req, res) => {
  const adminKey = req.headers['x-admin-key'];
  if (adminKey !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const { id } = req.params;
  const updates = req.body;
  try {
    const { error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ── Stripe: Create Payment Intent (Seller 1%) ─────────────────
app.post('/api/payments/create-intent', async (req, res) => {
  const { sale_price, payment_type, user_id, listing_id } = req.body;
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  
  try {
    const fee = Math.round(sale_price * 0.01 * 100); // 1% in cents
    const paymentIntent = await stripe.paymentIntents.create({
      amount: fee,
      currency: 'usd',
      metadata: { user_id, listing_id, type: 'seller_platform_fee', sale_price: sale_price.toString() }
    });
    
    // Save payment record to Supabase
    await supabase.from('payments').insert({
      user_id,
      listing_id,
      amount: fee / 100,
      fee_type: 'seller_platform_fee',
      status: 'pending',
      payment_method: payment_type,
      stripe_intent_id: paymentIntent.id
    });
    
    res.json({ client_secret: paymentIntent.client_secret, amount: fee });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Stripe: Create Payment Intent (Agent 10%) ─────────────────
app.post('/api/payments/agent-fee', async (req, res) => {
  const { commission_amount, payment_type, agent_id, deal_id } = req.body;
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  
  try {
    const fee = Math.round(commission_amount * 0.10 * 100); // 10% in cents
    const paymentIntent = await stripe.paymentIntents.create({
      amount: fee,
      currency: 'usd',
      metadata: { agent_id, deal_id, type: 'agent_referral_fee', commission: commission_amount.toString() }
    });
    
    await supabase.from('payments').insert({
      user_id: agent_id,
      amount: fee / 100,
      fee_type: 'agent_referral_fee',
      status: 'pending',
      payment_method: payment_type,
      stripe_intent_id: paymentIntent.id
    });
    
    res.json({ client_secret: paymentIntent.client_secret, amount: fee });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Mark Check Payment ────────────────────────────────────────
app.post('/api/payments/mark-check', async (req, res) => {
  const adminKey = req.headers['x-admin-key'];
  if (adminKey !== process.env.ADMIN_PASSWORD) return res.status(401).json({ error: 'Unauthorized' });
  const { payment_id } = req.body;
  try {
    const { error } = await supabase.from('payments').update({ status: 'paid' }).eq('id', payment_id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Get Payments (Admin) ──────────────────────────────────────
app.get('/api/admin/payments', async (req, res) => {
  const adminKey = req.headers['x-admin-key'];
  if (adminKey !== process.env.ADMIN_PASSWORD) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { data, error } = await supabase.from('payments').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ payments: data || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`ListDirect running on port ${PORT}`));
