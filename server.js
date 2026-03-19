const express = require('express');
const path = require('path');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// ── Email via Resend ──────────────────────────────────────────
async function sendEmail({ to, subject, html }) {
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'ListDirect <onboarding@resend.dev>',
        reply_to: 'infolistdirect@gmail.com',
        to,
        subject,
        html
      })
    });
    const data = await res.json();
    return data;
  } catch(err) {
    console.error('Email error:', err);
  }
}

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
    
    // Send notification emails on signup
    const role = req.body.role;
    if (role === 'agent') {
      // Email to admin about new agent application
      await sendEmail({
        to: 'infolistdirect@gmail.com',
        subject: '🤝 New Agent Application — ' + (req.body.full_name || 'Unknown'),
        html: `
          <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#0a0f0d;color:#e8f0e9;border-radius:12px;padding:32px">
            <h2 style="color:#3ef07a;margin-bottom:4px">New Agent Application</h2>
            <p style="color:#7a9480;margin-bottom:24px">Someone applied to join your certified agent network</p>
            <table style="width:100%;border-collapse:collapse">
              <tr><td style="padding:10px;color:#7a9480;border-bottom:1px solid #1f2d22">Name</td><td style="padding:10px;color:#e8f0e9;border-bottom:1px solid #1f2d22"><strong>${req.body.full_name || '—'}</strong></td></tr>
              <tr><td style="padding:10px;color:#7a9480;border-bottom:1px solid #1f2d22">Email</td><td style="padding:10px;color:#e8f0e9;border-bottom:1px solid #1f2d22">${req.body.email}</td></tr>
              <tr><td style="padding:10px;color:#7a9480;border-bottom:1px solid #1f2d22">Phone</td><td style="padding:10px;color:#e8f0e9;border-bottom:1px solid #1f2d22">${req.body.phone || '—'}</td></tr>
              <tr><td style="padding:10px;color:#7a9480;border-bottom:1px solid #1f2d22">License</td><td style="padding:10px;color:#e8f0e9;border-bottom:1px solid #1f2d22">${req.body.license_number || '—'}</td></tr>
              <tr><td style="padding:10px;color:#7a9480;border-bottom:1px solid #1f2d22">Location</td><td style="padding:10px;color:#e8f0e9;border-bottom:1px solid #1f2d22">${req.body.location || '—'}</td></tr>
              <tr><td style="padding:10px;color:#7a9480;border-bottom:1px solid #1f2d22">Specialty</td><td style="padding:10px;color:#e8f0e9;border-bottom:1px solid #1f2d22">${req.body.specialty || '—'}</td></tr>
              <tr><td style="padding:10px;color:#7a9480;border-bottom:1px solid #1f2d22">Cashback Offer</td><td style="padding:10px;color:#f5c842;border-bottom:1px solid #1f2d22">${req.body.cashback_offer || '1'}% to sellers</td></tr>
              <tr><td style="padding:10px;color:#7a9480">Bio</td><td style="padding:10px;color:#e8f0e9">${req.body.bio || '—'}</td></tr>
            </table>
            <div style="margin-top:24px;text-align:center">
              <a href="https://list-direct.onrender.com/admin.html" style="background:#3ef07a;color:#0a0f0d;padding:12px 28px;border-radius:50px;text-decoration:none;font-weight:700;display:inline-block">Review Application →</a>
            </div>
          </div>
        `
      });
    } else {
      // Email to new regular user - welcome
      await sendEmail({
        to: req.body.email,
        subject: 'Welcome to ListDirect! 🏡',
        html: `
          <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#0a0f0d;color:#e8f0e9;border-radius:12px;padding:32px">
            <h1 style="color:#3ef07a;font-size:2rem;margin-bottom:4px">Welcome to ListDirect!</h1>
            <p style="color:#7a9480;margin-bottom:24px">You're one step closer to saving thousands on your home sale.</p>
            <p style="color:#e8f0e9">Hi ${req.body.full_name || 'there'},</p>
            <p style="color:#7a9480">Your account is almost ready. Please check your email and confirm your address to get started.</p>
            <p style="color:#7a9480;margin-top:16px">Once confirmed you can:</p>
            <ul style="color:#7a9480;line-height:2">
              <li>List your home for just 1% at closing</li>
              <li>Use our AI pricing and listing tools</li>
              <li>Browse certified agents with guaranteed cashback</li>
            </ul>
            <div style="margin-top:24px;text-align:center">
              <a href="https://list-direct.onrender.com/dashboard.html" style="background:#3ef07a;color:#0a0f0d;padding:12px 28px;border-radius:50px;text-decoration:none;font-weight:700;display:inline-block">Go to My Account →</a>
            </div>
            <p style="color:#3d5240;font-size:0.8rem;margin-top:32px;text-align:center">Questions? Email us at infolistdirect@gmail.com</p>
          </div>
        `
      });
    }
    
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
    
    // Send notification emails on signup
    const role = req.body.role;
    if (role === 'agent') {
      // Email to admin about new agent application
      await sendEmail({
        to: 'infolistdirect@gmail.com',
        subject: '🤝 New Agent Application — ' + (req.body.full_name || 'Unknown'),
        html: `
          <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#0a0f0d;color:#e8f0e9;border-radius:12px;padding:32px">
            <h2 style="color:#3ef07a;margin-bottom:4px">New Agent Application</h2>
            <p style="color:#7a9480;margin-bottom:24px">Someone applied to join your certified agent network</p>
            <table style="width:100%;border-collapse:collapse">
              <tr><td style="padding:10px;color:#7a9480;border-bottom:1px solid #1f2d22">Name</td><td style="padding:10px;color:#e8f0e9;border-bottom:1px solid #1f2d22"><strong>${req.body.full_name || '—'}</strong></td></tr>
              <tr><td style="padding:10px;color:#7a9480;border-bottom:1px solid #1f2d22">Email</td><td style="padding:10px;color:#e8f0e9;border-bottom:1px solid #1f2d22">${req.body.email}</td></tr>
              <tr><td style="padding:10px;color:#7a9480;border-bottom:1px solid #1f2d22">Phone</td><td style="padding:10px;color:#e8f0e9;border-bottom:1px solid #1f2d22">${req.body.phone || '—'}</td></tr>
              <tr><td style="padding:10px;color:#7a9480;border-bottom:1px solid #1f2d22">License</td><td style="padding:10px;color:#e8f0e9;border-bottom:1px solid #1f2d22">${req.body.license_number || '—'}</td></tr>
              <tr><td style="padding:10px;color:#7a9480;border-bottom:1px solid #1f2d22">Location</td><td style="padding:10px;color:#e8f0e9;border-bottom:1px solid #1f2d22">${req.body.location || '—'}</td></tr>
              <tr><td style="padding:10px;color:#7a9480;border-bottom:1px solid #1f2d22">Specialty</td><td style="padding:10px;color:#e8f0e9;border-bottom:1px solid #1f2d22">${req.body.specialty || '—'}</td></tr>
              <tr><td style="padding:10px;color:#7a9480;border-bottom:1px solid #1f2d22">Cashback Offer</td><td style="padding:10px;color:#f5c842;border-bottom:1px solid #1f2d22">${req.body.cashback_offer || '1'}% to sellers</td></tr>
              <tr><td style="padding:10px;color:#7a9480">Bio</td><td style="padding:10px;color:#e8f0e9">${req.body.bio || '—'}</td></tr>
            </table>
            <div style="margin-top:24px;text-align:center">
              <a href="https://list-direct.onrender.com/admin.html" style="background:#3ef07a;color:#0a0f0d;padding:12px 28px;border-radius:50px;text-decoration:none;font-weight:700;display:inline-block">Review Application →</a>
            </div>
          </div>
        `
      });
    } else {
      // Email to new regular user - welcome
      await sendEmail({
        to: req.body.email,
        subject: 'Welcome to ListDirect! 🏡',
        html: `
          <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#0a0f0d;color:#e8f0e9;border-radius:12px;padding:32px">
            <h1 style="color:#3ef07a;font-size:2rem;margin-bottom:4px">Welcome to ListDirect!</h1>
            <p style="color:#7a9480;margin-bottom:24px">You're one step closer to saving thousands on your home sale.</p>
            <p style="color:#e8f0e9">Hi ${req.body.full_name || 'there'},</p>
            <p style="color:#7a9480">Your account is almost ready. Please check your email and confirm your address to get started.</p>
            <p style="color:#7a9480;margin-top:16px">Once confirmed you can:</p>
            <ul style="color:#7a9480;line-height:2">
              <li>List your home for just 1% at closing</li>
              <li>Use our AI pricing and listing tools</li>
              <li>Browse certified agents with guaranteed cashback</li>
            </ul>
            <div style="margin-top:24px;text-align:center">
              <a href="https://list-direct.onrender.com/dashboard.html" style="background:#3ef07a;color:#0a0f0d;padding:12px 28px;border-radius:50px;text-decoration:none;font-weight:700;display:inline-block">Go to My Account →</a>
            </div>
            <p style="color:#3d5240;font-size:0.8rem;margin-top:32px;text-align:center">Questions? Email us at infolistdirect@gmail.com</p>
          </div>
        `
      });
    }
    
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
    
    // If agent was just approved, send them a welcome email
    if (updates.approved === true) {
      const { data: profile } = await supabase.from('profiles').select('*').eq('id', id).single();
      const { data: authData } = await supabase.auth.admin.getUserById(id);
      const agentEmail = authData?.user?.email;
      if (agentEmail) {
        await sendEmail({
          to: agentEmail,
          subject: "🎉 You're now a ListDirect Certified Agent!",
          html: `
            <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#0a0f0d;color:#e8f0e9;border-radius:12px;padding:32px">
              <h1 style="color:#f5c842;font-size:2rem;margin-bottom:4px">Congratulations!</h1>
              <p style="color:#7a9480;margin-bottom:24px">You are now a ListDirect Certified Agent</p>
              <p style="color:#e8f0e9">Hi ${profile?.full_name || 'there'},</p>
              <p style="color:#7a9480">Your application has been approved! Your profile is now live on our agent directory and you will start receiving seller leads through our platform.</p>
              <div style="background:#192019;border:1px solid #1f2d22;border-radius:12px;padding:20px;margin:20px 0">
                <p style="color:#f5c842;font-weight:700;margin-bottom:12px">What happens next:</p>
                <ul style="color:#7a9480;line-height:2;margin:0;padding-left:20px">
                  <li>Sellers can now find and request you on our platform</li>
                  <li>You'll receive email notifications when a seller requests you</li>
                  <li>Remember: give sellers your committed ${profile?.cashback_offer || '1'}% cashback at closing</li>
                  <li>Pay ListDirect your 10% referral fee within 30 days of closing</li>
                </ul>
              </div>
              <div style="margin-top:24px;text-align:center">
                <a href="https://list-direct.onrender.com/agent-portal.html" style="background:#f5c842;color:#1a1200;padding:12px 28px;border-radius:50px;text-decoration:none;font-weight:700;display:inline-block">Go to Agent Portal →</a>
              </div>
              <p style="color:#3d5240;font-size:0.8rem;margin-top:32px;text-align:center">Questions? Email us at infolistdirect@gmail.com</p>
            </div>
          `
        });
      }
    }
    
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
    
    // Notify admin of new payment
    await sendEmail({
      to: 'infolistdirect@gmail.com',
      subject: '💰 New Payment Initiated — Seller Platform Fee',
      html: `<div style="font-family:Arial,sans-serif;background:#0a0f0d;color:#e8f0e9;padding:24px;border-radius:12px"><h2 style="color:#3ef07a">New Seller Payment</h2><p>Amount: <strong>$${(fee/100).toLocaleString()}</strong></p><p>Sale Price: <strong>$${parseInt(sale_price).toLocaleString()}</strong></p><p>Method: <strong>${payment_type}</strong></p><a href="https://list-direct.onrender.com/admin.html" style="background:#3ef07a;color:#0a0f0d;padding:10px 20px;border-radius:50px;text-decoration:none;font-weight:700;display:inline-block;margin-top:12px">View in Admin →</a></div>`
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


// ── Notify: Agent Request ─────────────────────────────────────
app.post('/api/notify/agent-request', async (req, res) => {
  const { agent_name, agent_email, seller_name, seller_email, seller_phone, seller_address, seller_price, cashback } = req.body;
  try {
    // Email to admin
    await sendEmail({
      to: 'infolistdirect@gmail.com',
      subject: `🏠 New Agent Request — ${seller_name} selected ${agent_name}`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#0a0f0d;color:#e8f0e9;border-radius:12px;padding:32px">
          <h2 style="color:#f5c842">New Agent Request!</h2>
          <p style="color:#7a9480;margin-bottom:20px">A seller has selected a certified agent through ListDirect</p>
          <table style="width:100%;border-collapse:collapse">
            <tr><td style="padding:10px;color:#7a9480;border-bottom:1px solid #1f2d22">Agent</td><td style="padding:10px;color:#f5c842;border-bottom:1px solid #1f2d22"><strong>${agent_name}</strong></td></tr>
            <tr><td style="padding:10px;color:#7a9480;border-bottom:1px solid #1f2d22">Seller Name</td><td style="padding:10px;color:#e8f0e9;border-bottom:1px solid #1f2d22">${seller_name}</td></tr>
            <tr><td style="padding:10px;color:#7a9480;border-bottom:1px solid #1f2d22">Seller Email</td><td style="padding:10px;color:#e8f0e9;border-bottom:1px solid #1f2d22">${seller_email}</td></tr>
            <tr><td style="padding:10px;color:#7a9480;border-bottom:1px solid #1f2d22">Seller Phone</td><td style="padding:10px;color:#e8f0e9;border-bottom:1px solid #1f2d22">${seller_phone}</td></tr>
            <tr><td style="padding:10px;color:#7a9480;border-bottom:1px solid #1f2d22">Property Address</td><td style="padding:10px;color:#e8f0e9;border-bottom:1px solid #1f2d22">${seller_address}</td></tr>
            <tr><td style="padding:10px;color:#7a9480">Asking Price</td><td style="padding:10px;color:#3ef07a">${seller_price}</td></tr>
          </table>
          <a href="https://list-direct.onrender.com/admin.html" style="display:inline-block;margin-top:24px;background:#f5c842;color:#1a1200;padding:12px 28px;border-radius:50px;text-decoration:none;font-weight:700">View in Admin →</a>
        </div>
      `
    });

    // Email to the agent if they have an email
    if (agent_email) {
      await sendEmail({
        to: agent_email,
        subject: `🏠 New Seller Lead — ${seller_name} wants to work with you!`,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#0a0f0d;color:#e8f0e9;border-radius:12px;padding:32px">
            <h2 style="color:#f5c842">You have a new lead!</h2>
            <p style="color:#7a9480;margin-bottom:20px">A seller has selected you through ListDirect. Reach out within 24 hours!</p>
            <table style="width:100%;border-collapse:collapse">
              <tr><td style="padding:10px;color:#7a9480;border-bottom:1px solid #1f2d22">Seller Name</td><td style="padding:10px;color:#e8f0e9;border-bottom:1px solid #1f2d22"><strong>${seller_name}</strong></td></tr>
              <tr><td style="padding:10px;color:#7a9480;border-bottom:1px solid #1f2d22">Email</td><td style="padding:10px;color:#3ef07a;border-bottom:1px solid #1f2d22">${seller_email}</td></tr>
              <tr><td style="padding:10px;color:#7a9480;border-bottom:1px solid #1f2d22">Phone</td><td style="padding:10px;color:#e8f0e9;border-bottom:1px solid #1f2d22">${seller_phone}</td></tr>
              <tr><td style="padding:10px;color:#7a9480;border-bottom:1px solid #1f2d22">Property</td><td style="padding:10px;color:#e8f0e9;border-bottom:1px solid #1f2d22">${seller_address}</td></tr>
              <tr><td style="padding:10px;color:#7a9480">Asking Price</td><td style="padding:10px;color:#3ef07a">${seller_price}</td></tr>
            </table>
            <div style="background:#192019;border:1px solid #1f2d22;border-radius:12px;padding:16px;margin:20px 0">
              <p style="color:#f5c842;font-weight:700;margin-bottom:8px">Remember your commitment:</p>
              <p style="color:#7a9480">You have agreed to give this seller a minimum <strong style="color:#f5c842">${cashback}</strong> cashback at closing, and to pay ListDirect a 10% referral fee from your commission.</p>
            </div>
            <a href="https://list-direct.onrender.com/agent-portal.html" style="display:inline-block;margin-top:8px;background:#f5c842;color:#1a1200;padding:12px 28px;border-radius:50px;text-decoration:none;font-weight:700">Go to Agent Portal →</a>
          </div>
        `
      });
    }

    res.json({ success: true });
  } catch(err) {
    console.error('Notify error:', err);
    res.json({ success: true }); // Don't fail the request if email fails
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`ListDirect running on port ${PORT}`));
