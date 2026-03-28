const express = require('express');
const path = require('path');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// ── Email Header/Footer ────────────────────────────────────────
function emailHeader() {
  return `<table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#0a0f0d">
    <tr><td bgcolor="#0a0f0d" style="background-color:#0a0f0d;padding:24px 32px;text-align:center;border-bottom:2px solid #3ef07a">
      <span style="font-family:Georgia,serif;font-size:1.6rem;font-weight:900;color:#3ef07a;letter-spacing:-0.5px">List<span style="color:#ffffff">Direct</span></span><br>
      <span style="font-size:0.75rem;color:#7a9480;font-family:Arial,sans-serif;letter-spacing:1px;text-transform:uppercase">Skip the Agent. List Direct.</span>
    </td></tr>
  </table>`;
}
function emailFooter() {
  return `<table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#060c09">
    <tr><td bgcolor="#060c09" style="background-color:#060c09;padding:20px 32px;text-align:center;border-top:1px solid #1f2d22">
      <a href="https://listdirect.ai" style="color:#3ef07a;font-family:Arial,sans-serif;font-size:0.8rem;text-decoration:none">listdirect.ai</a><br>
      <span style="color:#3a4d3e;font-family:Arial,sans-serif;font-size:0.75rem;">© 2026 ListDirect. All rights reserved.</span>
    </td></tr>
  </table>`;
}
function emailWrap(content) {
  return `<table width="600" cellpadding="0" cellspacing="0" border="1" style="max-width:600px;width:100%;border-collapse:collapse;border:2px solid #1f2d22;border-radius:12px" bgcolor="#0a0f0d">
    <tr><td bgcolor="#0a0f0d" style="background-color:#0a0f0d;padding:0">${emailHeader()}</td></tr>
    <tr><td bgcolor="#0a0f0d" style="background-color:#0a0f0d;padding:32px;color:#e8f0e9;font-family:Arial,sans-serif">${content}</td></tr>
    <tr><td bgcolor="#060c09" style="background-color:#060c09;padding:0">${emailFooter()}</td></tr>
  </table>`;
}

// ── Email via Resend ──────────────────────────────────────────
async function sendEmail({ to, subject, html, reply_to }) {
  const wrappedHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark"></head><body style="margin:0;padding:0;background-color:#0a0f0d" bgcolor="#0a0f0d"><table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#0a0f0d" bgcolor="#0a0f0d"><tr><td align="center" style="padding:20px;background-color:#0a0f0d" bgcolor="#0a0f0d"><table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%"><tr><td style="background-color:#0a0f0d;padding:0" bgcolor="#0a0f0d">${html}</td></tr></table></td></tr></table></body></html>`;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'ListDirect <noreply@listdirect.ai>',
        reply_to: reply_to || 'infolistdirect@gmail.com',
        to,
        subject,
        html: wrappedHtml
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
              <a href="https://listdirect.ai/admin.html" style="background:#3ef07a;color:#0a0f0d;padding:12px 28px;border-radius:50px;text-decoration:none;font-weight:700;display:inline-block">Review Application →</a>
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
              <a href="https://listdirect.ai/dashboard.html" style="background:#3ef07a;color:#0a0f0d;padding:12px 28px;border-radius:50px;text-decoration:none;font-weight:700;display:inline-block">Go to My Account →</a>
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

app.post('/api/auth/refresh', async (req, res) => {
  const { refresh_token } = req.body;
  if (!refresh_token) return res.status(400).json({ error: 'Refresh token required' });
  try {
    const { data, error } = await supabase.auth.refreshSession({ refresh_token });
    if (error || !data.session) return res.status(401).json({ error: 'Session expired' });
    res.json({ session: data.session });
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
    const body = req.body;
    const listing = {
      user_id: user.id,
      address: body.address || '',
      city: body.city || '',
      state: body.state || '',
      zip: body.zip || '',
      price: body.price ? parseInt(body.price) : null,
      bedrooms: body.bedrooms ? parseInt(body.bedrooms) : null,
      bathrooms: body.bathrooms ? parseFloat(body.bathrooms) : null,
      sqft: body.sqft ? parseInt(body.sqft) : null,
      year_built: body.year_built ? parseInt(body.year_built) : null,
      property_type: body.property_type || '',
      features: body.features || '',
      description: body.description || '',
      photos: body.photos || [],
      status: 'active',
      listing_path: body.listing_path || 'direct'
    };
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
    res.json({ favorites: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/favorites/:listing_id', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const { data: { user } } = await supabase.auth.getUser(token);
    const { error } = await supabase.from('favorites').delete().eq('user_id', user.id).eq('listing_id', req.params.listing_id);
    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ── Auth: Reset Password (send email via Resend) ─────────────
app.post('/api/auth/reset-password', async (req, res) => {
  const { email } = req.body;
  try {
    const siteUrl = 'https://listdirect.ai';
    // Generate reset token via Supabase admin
    const adminSupabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    // Get user by email first
    const { data: { users }, error: listErr } = await adminSupabase.auth.admin.listUsers();
    if (listErr) return res.status(400).json({ error: listErr.message });
    const user = users.find(u => u.email === email);
    if (!user) {
      // Don't reveal if email exists - just say sent
      return res.json({ success: true });
    }
    // Generate a magic link / recovery link
    const { data: linkData, error: linkErr } = await adminSupabase.auth.admin.generateLink({
      type: 'recovery',
      email: email,
      options: { redirectTo: siteUrl + '/reset-password.html' }
    });
    if (linkErr) return res.status(400).json({ error: linkErr.message });
    // Send via Resend
    await sendEmail({
      to: email,
      subject: 'Reset Your ListDirect Password',
      html: emailWrap(`
        <h2 style="color:#3ef07a;margin:0 0 8px">Reset Your Password</h2>
        <p style="color:#7a9480;margin:0 0 20px">Hi there,</p>
        <p style="color:#e8f0e9;margin-bottom:24px">We received a request to reset your ListDirect password. Click the button below to set a new password:</p>
        <a href="${linkData.properties.action_link}" style="background:#3ef07a;color:#0a0f0d;padding:14px 32px;border-radius:50px;text-decoration:none;font-weight:700;display:inline-block;margin-bottom:20px">Reset Password</a>
        <p style="color:#7a9480;font-size:0.85rem;margin-top:16px">This link expires in 1 hour. If you did not request a password reset, you can ignore this email.</p>
      `)
    });
    res.json({ success: true });
  } catch (err) {
    console.error('Reset password exception:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Auth: Update Password ─────────────────────────────────────
app.post('/api/auth/update-password', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const { password } = req.body;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    // Verify the token to get the user
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return res.status(401).json({ error: 'Not authenticated' });
    // Use admin to update password - works regardless of session state
    const adminSupabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const { error } = await adminSupabase.auth.admin.updateUserById(user.id, { password: String(password) });
    if (error) return res.status(400).json({ error: error.message });
    // Send confirmation email
    await sendEmail({
      to: user.email,
      subject: 'Your ListDirect password has been changed',
      html: emailWrap(`
        <h2 style="color:#3ef07a;margin:0 0 8px">Password Changed</h2>
        <p style="color:#7a9480;margin:0 0 16px">Hi there,</p>
        <p style="color:#e8f0e9">Your ListDirect password was successfully updated.</p>
        <p style="color:#7a9480;margin-top:12px;font-size:0.88rem">If you did not make this change, contact us immediately at <a href="mailto:noreply@listdirect.ai" style="color:#3ef07a">noreply@listdirect.ai</a></p>
        <a href="https://listdirect.ai" style="background:#3ef07a;color:#0a0f0d;padding:12px 28px;border-radius:50px;text-decoration:none;font-weight:700;display:inline-block;margin-top:20px">Go to ListDirect</a>
      `)
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ── Auth: Update Profile ──────────────────────────────────────
app.post('/api/auth/update-profile', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return res.status(401).json({ error: 'Not authenticated' });
    // Strip ALL non-ASCII from every incoming value
    const clean = v => typeof v === 'string' ? v.replace(/[^\x00-\x7F]/g, '').trim() : (v || '');
    const full_name = clean(req.body.full_name);
    const phone = clean(req.body.phone);
    const location = clean(req.body.location);
    const license_number = clean(req.body.license_number);
    const bio = clean(req.body.bio);
    const cashback_offer = clean(req.body.cashback_offer) || '1';
    // Only update profiles table - skip Auth metadata entirely
    const specialty = clean(req.body.specialty);
    const years_experience = clean(req.body.years_experience);
    const languages = clean(req.body.languages);
    const designations = clean(req.body.designations);
    // Use anon key directly - RLS disabled on profiles table
    const { error: profErr } = await supabase.from('profiles')
      .upsert({ id: user.id, full_name, phone, location, license_number, bio, cashback_offer, specialty, years_experience, languages, designations }, { onConflict: 'id' });
    if (profErr) return res.status(400).json({ error: profErr.message });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Agent: Upload Avatar ─────────────────────────────────────
app.post('/api/agent/avatar', upload.single('photo'), async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return res.status(401).json({ error: 'Not authenticated' });
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'No file uploaded' });
    const ext = file.originalname.split('.').pop().toLowerCase();
    const fileName = user.id + '/avatar.' + ext;
    const { error: upErr } = await supabase.storage.from('agent-avatars').upload(fileName, file.buffer, {
      contentType: file.mimetype, upsert: true
    });
    if (upErr) return res.status(400).json({ error: upErr.message });
    const { data: { publicUrl } } = supabase.storage.from('agent-avatars').getPublicUrl(fileName);
    await supabase.from('profiles').update({ avatar_url: publicUrl }).eq('id', user.id);
    res.json({ success: true, url: publicUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Auth: Clean User Metadata (one-time fix) ─────────────────
app.post('/api/auth/clean-metadata', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return res.status(401).json({ error: 'Not authenticated' });
    const adminSupabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const cleanStr = s => typeof s === 'string' ? s.replace(/[^ -]/g, '').trim() : s;
    const cleanMeta = {};
    Object.keys(user.user_metadata || {}).forEach(k => {
      cleanMeta[k] = cleanStr(user.user_metadata[k]);
    });
    const { error } = await adminSupabase.auth.admin.updateUserById(user.id, { user_metadata: cleanMeta });
    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true, cleaned: cleanMeta });
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
                <a href="https://listdirect.ai/agent-portal.html" style="background:#f5c842;color:#1a1200;padding:12px 28px;border-radius:50px;text-decoration:none;font-weight:700;display:inline-block">Go to Agent Portal →</a>
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
      html: `<div style="font-family:Arial,sans-serif;background:#0a0f0d;color:#e8f0e9;padding:24px;border-radius:12px"><h2 style="color:#3ef07a">New Seller Payment</h2><p>Amount: <strong>$${(fee/100).toLocaleString()}</strong></p><p>Sale Price: <strong>$${parseInt(sale_price).toLocaleString()}</strong></p><p>Method: <strong>${payment_type}</strong></p><a href="https://listdirect.ai/admin.html" style="background:#3ef07a;color:#0a0f0d;padding:10px 20px;border-radius:50px;text-decoration:none;font-weight:700;display:inline-block;margin-top:12px">View in Admin →</a></div>`
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
          <a href="https://listdirect.ai/admin.html" style="display:inline-block;margin-top:24px;background:#f5c842;color:#1a1200;padding:12px 28px;border-radius:50px;text-decoration:none;font-weight:700">View in Admin →</a>
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
            <a href="https://listdirect.ai/agent-portal.html" style="display:inline-block;margin-top:8px;background:#f5c842;color:#1a1200;padding:12px 28px;border-radius:50px;text-decoration:none;font-weight:700">Go to Agent Portal →</a>
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


// ── Listings: Track View ──────────────────────────────────────
app.post('/api/listings/:id/view', async (req, res) => {
  try {
    const { data: listing } = await supabase.from('listings').select('view_count').eq('id', req.params.id).single();
    const currentViews = listing?.view_count || 0;
    await supabase.from('listings').update({ view_count: currentViews + 1 }).eq('id', req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false });
  }
});

// ── Listings: Update ──────────────────────────────────────────
app.patch('/api/listings/:id', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const { data: { user } } = await supabase.auth.getUser(token);
    if (!user) return res.status(401).json({ error: 'Invalid token' });
    const { id } = req.params;
    const body = req.body;
    const updates = {
      address: body.address,
      city: body.city,
      state: body.state,
      zip: body.zip,
      price: body.price ? parseInt(body.price) : null,
      bedrooms: body.bedrooms ? parseInt(body.bedrooms) : null,
      bathrooms: body.bathrooms ? parseFloat(body.bathrooms) : null,
      sqft: body.sqft ? parseInt(body.sqft) : null,
      year_built: body.year_built ? parseInt(body.year_built) : null,
      property_type: body.property_type,
      features: body.features,
      description: body.description,
      photos: body.photos,
      listing_path: body.listing_path
    };
    const { data, error } = await supabase
      .from('listings')
      .update(updates)
      .eq('id', id)
      .eq('user_id', user.id) // make sure user owns this listing
      .select()
      .single();
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ── Offers: Submit ────────────────────────────────────────────
app.post('/api/offers', async (req, res) => {
  const { seller_id, property, offer_amount, buyer_name, buyer_email, buyer_phone, message } = req.body;
  if (!buyer_name || !buyer_email || !offer_amount) return res.status(400).json({ error: 'Missing required fields' });
  try {
    // Store offer in messages table with type 'offer'
    await supabase.from('messages').insert([{
      seller_id,
      sender_name: buyer_name,
      sender_email: buyer_email,
      message: `💰 OFFER: $${parseInt(offer_amount).toLocaleString()}\n\nProperty: ${property}\nPhone: ${buyer_phone || 'Not provided'}\n\n${message ? 'Note: ' + message : ''}`,
      read: false,
      created_at: new Date().toISOString()
    }]);

    // Notify seller via email
    const { data: sellerAuth } = await supabase.auth.admin.getUserById(seller_id).catch(() => ({ data: null }));
    if (sellerAuth?.user?.email) {
      await sendEmail({
        to: sellerAuth.user.email,
        reply_to: buyer_email,
        subject: `💰 New Offer — $${parseInt(offer_amount).toLocaleString()} on your listing!`,
        html: `<div style="font-family:Arial,sans-serif;background:#0a0f0d;color:#e8f0e9;padding:32px;border-radius:12px;max-width:600px">
          <h2 style="color:#3ef07a">💰 You received an offer!</h2>
          <div style="background:#1a3d28;border:1px solid rgba(62,240,122,0.3);border-radius:12px;padding:20px;margin:16px 0;text-align:center">
            <div style="font-size:0.85rem;color:#7a9480;margin-bottom:4px">Offer Amount</div>
            <div style="font-family:Georgia,serif;font-size:2.5rem;font-weight:900;color:#3ef07a">$${parseInt(offer_amount).toLocaleString()}</div>
          </div>
          <div style="background:#141c16;border:1px solid #1f2d22;border-radius:12px;padding:20px;margin:16px 0">
            <p><strong style="color:#e8f0e9">Property:</strong> <span style="color:#7a9480">${property}</span></p>
            <p><strong style="color:#e8f0e9">Buyer:</strong> <span style="color:#7a9480">${buyer_name}</span></p>
            <p><strong style="color:#e8f0e9">Email:</strong> <span style="color:#7a9480">${buyer_email}</span></p>
            ${buyer_phone ? `<p><strong style="color:#e8f0e9">Phone:</strong> <span style="color:#7a9480">${buyer_phone}</span></p>` : ''}
            ${message ? `<p><strong style="color:#e8f0e9">Note:</strong> <span style="color:#7a9480">${message}</span></p>` : ''}
          </div>
          <a href="mailto:${buyer_email}" style="display:inline-block;background:#3ef07a;color:#0a0f0d;padding:12px 28px;border-radius:50px;text-decoration:none;font-weight:700;margin-right:10px">Reply to Buyer →</a>
          <a href="https://listdirect.ai/dashboard.html" style="display:inline-block;background:none;border:1px solid #3ef07a;color:#3ef07a;padding:12px 28px;border-radius:50px;text-decoration:none;font-weight:700">View in Dashboard →</a>
        </div>`
      });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Offer error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Messages: Send ────────────────────────────────────────────
app.post('/api/messages', async (req, res) => {
  const { listing_id, seller_id, sender_name, sender_email, message } = req.body;
  const token = req.headers.authorization?.replace('Bearer ', '');
  let sender_id = null;
  if (token) {
    const { data: { user } } = await supabase.auth.getUser(token).catch(() => ({ data: { user: null } }));
    sender_id = user?.id || null;
  }
  try {
    // Only use listing_id if it's a valid UUID, otherwise null
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const validListingId = listing_id && uuidRegex.test(listing_id) ? listing_id : null;
    const validSellerId = seller_id && uuidRegex.test(seller_id) ? seller_id : null;

    const { data, error } = await supabase.from('messages').insert([{
      listing_id: validListingId,
      seller_id: validSellerId,
      sender_id,
      sender_name, sender_email, message, read: false
    }]).select().single();
    if (error) return res.status(400).json({ error: error.message });

    // Notify seller via email
    const { data: sellerAuth } = await supabase.auth.admin.getUserById(seller_id).catch(() => ({ data: null }));
    if (sellerAuth?.user?.email) {
      await sendEmail({
        to: sellerAuth.user.email,
        subject: '💬 New Inquiry — ' + sender_name + ' is interested in your listing!',
        html: `<div style="font-family:Arial,sans-serif;background:#0a0f0d;color:#e8f0e9;padding:32px;border-radius:12px;max-width:600px">
          <h2 style="color:#3ef07a">New Inquiry on Your Listing!</h2>
          <p style="color:#7a9480">Someone is interested in your property.</p>
          <div style="background:#141c16;border:1px solid #1f2d22;border-radius:12px;padding:20px;margin:16px 0">
            <p><strong>From:</strong> ${sender_name}</p>
            <p><strong>Email:</strong> ${sender_email}</p>
            <p style="margin-top:12px;color:#e8f0e9">"${message}"</p>
          </div>
          <a href="https://listdirect.ai/dashboard.html" style="background:#3ef07a;color:#0a0f0d;padding:12px 28px;border-radius:50px;text-decoration:none;font-weight:700;display:inline-block;margin-top:8px">Reply in Dashboard →</a>
        </div>`
      });
    }

    res.json({ success: true, id: data.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Messages: Get Inquiries (for seller) ──────────────────────
app.get('/api/messages/inquiries', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const { data: { user } } = await supabase.auth.getUser(token);
    if (!user) return res.status(401).json({ error: 'Invalid token' });
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('seller_id', user.id)
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ messages: data || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Messages: Reply ───────────────────────────────────────────
app.post('/api/messages/reply', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  const { original_message_id, reply_text, buyer_email, buyer_name } = req.body;
  if (!reply_text) return res.status(400).json({ error: 'Reply text is required' });
  try {
    const { data: { user } } = await supabase.auth.getUser(token);
    const { data: profile } = await supabase.from('profiles').select('full_name, email').eq('id', user.id).single();
    const sellerName = profile?.full_name || 'The Seller';
    const sellerEmail = user.email || profile?.email || 'infolistdirect@gmail.com';
    console.log('Seller email for reply-to:', sellerEmail);

    // Store reply in Supabase
    const { error: replyError } = await supabase.from('message_replies').insert([{
      message_id: original_message_id,
      sender_id: user.id,
      sender_name: sellerName,
      reply_text,
      created_at: new Date().toISOString()
    }]);
    if (replyError) console.log('Reply store error (non-fatal):', replyError.message);

    // Send reply email to buyer if we have their email
    if (buyer_email && buyer_email !== 'undefined' && buyer_email !== 'null') {
      await sendEmail({
        to: buyer_email,
        reply_to: sellerEmail,
        subject: '💬 Reply from your ListDirect inquiry',
        html: emailWrap(`
          <h2 style="color:#3ef07a;margin:0 0 8px">The seller replied to your inquiry!</h2>
          <p style="color:#7a9480;margin:0 0 20px">Hi ${buyer_name || 'there'},</p>
          <div style="background:#141c16;border:1px solid #1f2d22;border-radius:12px;padding:20px;margin:16px 0">
            <p style="color:#e8f0e9;margin:0">"${reply_text}"</p>
            <p style="color:#7a9480;margin:8px 0 0">— ${sellerName}</p>
          </div>
          <div style="background:#1a3d28;border:1px solid rgba(62,240,122,0.3);border-radius:12px;padding:16px;margin:16px 0">
            <p style="color:#3ef07a;font-weight:700;margin:0 0 6px">💬 Want to reply?</p>
            <p style="color:#e8f0e9;margin:0 0 12px">Simply reply to this email and your message will go directly to the seller.</p>
            <a href="mailto:${sellerEmail}" style="display:inline-block;background:#3ef07a;color:#0a0f0d;padding:10px 20px;border-radius:50px;font-weight:700;font-size:0.9rem;text-decoration:none">${sellerEmail}</a>
          </div>
          <a href="https://listdirect.ai" style="background:#3ef07a;color:#0a0f0d;padding:12px 28px;border-radius:50px;text-decoration:none;font-weight:700;display:inline-block;margin-top:8px">View on ListDirect →</a>
        `)
      });
    }

    // Mark original as read
    await supabase.from('messages').update({ read: true }).eq('id', original_message_id);

    res.json({ success: true, email_sent: !!(buyer_email && buyer_email !== 'undefined') });
  } catch (err) {
    console.error('Reply error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/messages/:id/replies', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const { data, error } = await supabase.from('message_replies')
      .select('*').eq('message_id', req.params.id).order('created_at', { ascending: true });
    if (error) return res.json({ replies: [] });
    res.json({ replies: data || [] });
  } catch (err) {
    res.json({ replies: [] });
  }
});

// ── Messages: Mark Read ───────────────────────────────────────
app.patch('/api/messages/:id/read', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    await supabase.from('messages').update({ read: true }).eq('id', req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ── Listings: Search Public ───────────────────────────────────
app.get('/api/listings/search', async (req, res) => {
  const { q, beds, maxPrice } = req.query;
  try {
    let query = supabase
      .from('listings')
      .select('*')
      .eq('status', 'active')
      .order('created_at', { ascending: false });

    if (q) {
      query = query.or(`city.ilike.%${q}%,address.ilike.%${q}%,state.ilike.%${q}%,zip.ilike.%${q}%`);
    }
    if (beds && parseInt(beds) > 0) {
      query = query.gte('bedrooms', parseInt(beds));
    }
    if (maxPrice && parseInt(maxPrice) > 0) {
      query = query.lte('price', parseInt(maxPrice));
    }

    const { data, error } = await query.limit(20);
    if (error) throw error;
    res.json({ listings: data || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ── Members: Count ────────────────────────────────────────────
app.get('/api/members/count', async (req, res) => {
  try {
    const { count: sellerCount } = await supabase
      .from('profiles')
      .select('*', { count: 'exact', head: true })
      .eq('role', 'seller');
    const { count: agentCount } = await supabase
      .from('profiles')
      .select('*', { count: 'exact', head: true })
      .eq('role', 'agent');
    res.json({ sellers: sellerCount || 0, agents: agentCount || 0, count: (sellerCount || 0) + (agentCount || 0) });
  } catch (err) {
    res.json({ sellers: 0, agents: 0, count: 0 });
  }
});


// ── Repliers MLS Listings (Canada) ───────────────────────────
app.get('/api/mls/canada', async (req, res) => {
  const { city, minBeds, maxPrice, minPrice, type } = req.query;
  try {
    const params = new URLSearchParams({
      status: 'A',
      limit: '20',
      sortBy: 'updatedOnDesc',
    });

    if (city) params.append('city', city);
    if (minBeds) params.append('minBeds', minBeds);
    if (maxPrice) params.append('maxPrice', maxPrice);
    if (minPrice) params.append('minPrice', minPrice);
    if (type) params.append('propertyType', type);

    const response = await fetch(`https://api.repliers.io/listings?${params.toString()}`, {
      headers: {
        'repliers-api-key': process.env.REPLIERS_API_KEY,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const err = await response.text();
      return res.status(response.status).json({ error: err, listings: [] });
    }

    const data = await response.json();
    const listings = (data.listings || []).map(l => ({
      id: l.mlsNumber || l.id,
      verified: false,
      platform: false,
      mls: true,
      price: parseInt(l.listPrice) || 0,
      currency: 'CAD',
      addr: l.address?.streetNumber + ' ' + l.address?.streetName + (l.address?.streetSuffix ? ' ' + l.address?.streetSuffix : ''),
      city: l.address?.city || city || '',
      zip: l.address?.zip || '',
      beds: parseInt(l.details?.numBedrooms) || 0,
      baths: parseFloat(l.details?.numBathrooms) || 0,
      sqft: parseInt(l.details?.sqft) || 0,
      type: l.details?.propertyType || 'house',
      days: Math.floor((Date.now() - new Date(l.listDate)) / 86400000) || 0,
      match: Math.floor(Math.random() * 15) + 80,
      img: l.images?.[0] || 'https://images.unsplash.com/photo-1570129477492-45c003edd2be?w=400&h=280&fit=crop',
      cashback: null,
      desc: l.details?.description || '',
      listing: 'mls'
    }));

    res.json({ listings });
  } catch (err) {
    console.error('Repliers error:', err.message);
    res.json({ listings: [], error: err.message });
  }
});


// ── Rentcast US Listings ──────────────────────────────────────
app.get('/api/listings/us', async (req, res) => {
  const { city, state, minBeds, maxPrice, minPrice } = req.query;
  try {
    const params = new URLSearchParams({
      limit: '20',
      status: 'Active',
    });

    if (city) params.append('city', city);
    if (state) params.append('state', state);
    if (minBeds) params.append('bedrooms', minBeds);
    if (maxPrice) params.append('maxPrice', maxPrice);
    if (minPrice) params.append('minPrice', minPrice);

    const response = await fetch(`https://api.rentcast.io/v1/listings/sale?${params.toString()}`, {
      headers: {
        'X-Api-Key': process.env.RENTCAST_API_KEY,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const err = await response.text();
      return res.status(response.status).json({ error: err, listings: [] });
    }

    const data = await response.json();
    if (data && data[0]) console.log('Rentcast sample fields:', Object.keys(data[0]));
    const listings = (data || []).map(l => ({
      id: l.id || l.formattedAddress,
      verified: false,
      platform: false,
      mls: false,
      us: true,
      price: parseInt(l.price) || 0,
      currency: 'USD',
      addr: l.addressLine1 || '',
      city: l.city || city || '',
      zip: l.zipCode || '',
      beds: parseInt(l.bedrooms) || 0,
      baths: parseFloat(l.bathrooms) || 0,
      sqft: parseInt(l.squareFootage) || 0,
      type: l.propertyType || 'Single Family',
      days: l.daysOnMarket || 0,
      match: Math.floor(Math.random() * 15) + 80,
      img: null,
      streetview_addr: ((l.addressLine1 || '') + ' ' + (l.city || '') + ' ' + (l.state || '') + ' ' + (l.zipCode || '')).trim(),
      lat: l.latitude || null,
      lng: l.longitude || null,
      cashback: null,
      desc: '',
      listing: 'rentcast'
    }));

    res.json({ listings });
  } catch (err) {
    console.error('Rentcast error:', err.message);
    res.json({ listings: [], error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`ListDirect running on port ${PORT}`));
