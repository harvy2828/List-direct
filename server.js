const express = require('express');
const path = require('path');
const multer = require('multer');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// ── Email Header/Footer ────────────────────────────────────────
function emailHeader() {
  return `<table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#0a0f0d">
    <tr><td bgcolor="#0a0f0d" style="background-color:#0a0f0d;padding:24px 32px;text-align:center;border-bottom:2px solid #3ef07a">
      <span style="font-family:Georgia,serif;font-size:1.6rem;font-weight:900;color:#3ef07a;letter-spacing:-0.5px">List<span style="color:#ffffff">Direct</span></span><br>
      <span style="font-size:0.75rem;color:#7a9480;font-family:Arial,sans-serif;letter-spacing:1px;text-transform:uppercase">Save More. List Direct.</span>
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
async function sendEmail({ to, subject, html, reply_to, cc }) {
  const wrappedHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark"></head><body style="margin:0;padding:0;background-color:#0a0f0d" bgcolor="#0a0f0d"><table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#0a0f0d" bgcolor="#0a0f0d"><tr><td align="center" style="padding:20px;background-color:#0a0f0d" bgcolor="#0a0f0d"><table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%"><tr><td style="background-color:#0a0f0d;padding:0" bgcolor="#0a0f0d">${html}</td></tr></table></td></tr></table></body></html>`;
  try {
    const body = {
      from: 'ListDirect <noreply@listdirect.ai>',
      reply_to: reply_to || 'infolistdirect@gmail.com',
      to,
      subject,
      html: wrappedHtml
    };
    if (cc) body.cc = cc;
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    return data;
  } catch(err) {
    console.error('Email error:', err);
  }
}

const app = express();
app.use(express.json());
// Never cache HTML pages — always serve the freshest version so deploys take
// effect immediately (prevents the browser/CDN from serving stale pages).
app.use((req, res, next) => {
  if (req.path === '/' || req.path.endsWith('.html')) {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
  }
  next();
});
app.use(express.static(__dirname));

// Auth client (public anon key) — used ONLY for auth: signUp, signIn, getUser, refreshSession.
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Data client (secret service key) — used for all table/storage reads & writes.
// This bypasses Row-Level Security, so the server keeps working after RLS is turned on.
// Falls back to the anon key only if the service key isn't set, so nothing breaks either way.
const db = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY
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
  const { email, password, full_name, role, phone, license_number, location, specialty, years_experience, cashback_offer, bio } = req.body;
  try {
    const { data, error } = await supabase.auth.signUp({
      email, password,
      options: { data: { full_name, role: role || 'buyer' } }
    });
    if (error) return res.status(400).json({ error: error.message });

    // Save full profile details to profiles table (especially for agents)
    if (data.user) {
      const adminClient = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY
      );
      await adminClient.from('profiles').upsert({
        id: data.user.id,
        full_name,
        role: role || 'buyer',
        email,
        phone: phone || null,
        license_number: license_number || null,
        location: location || null,
        specialty: specialty || null,
        years_experience: years_experience || null,
        cashback_offer: cashback_offer || '1',
        bio: bio || null,
        approved: false
      });
    }
    
    // Send notification emails on signup
    const notifyRole = role;
    if (notifyRole === 'agent') {
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
      // Welcome email to new regular user
      const firstName = req.body.full_name ? req.body.full_name.split(' ')[0] : 'there';
      await sendEmail({
        to: req.body.email,
        subject: 'Welcome to ListDirect — Real Savings. Real Simple. 🏡',
        html: emailWrap(`
          <h2 style="color:#3ef07a;margin:0 0 4px">Welcome to ListDirect, ${firstName}! 🎉</h2>
          <p style="color:#7a9480;margin:0 0 20px">You just made one of the smartest decisions a homeowner can make. We're glad you're here.</p>
          <div style="background:#1a3d28;border:1px solid rgba(62,240,122,0.3);border-radius:12px;padding:20px;margin-bottom:20px;text-align:center">
            <p style="color:#7a9480;margin:0 0 4px;font-size:0.85rem">On a $600K home, you pay 1% at closing — saving you</p>
            <div style="font-family:'Georgia',serif;font-size:2.2rem;font-weight:900;color:#3ef07a">$15,000+</div>
            <p style="color:#7a9480;margin:4px 0 0;font-size:0.85rem">vs. a traditional agent</p>
          </div>
          <p style="color:#e8f0e9;margin:0 0 8px">Here's everything you can do right now:</p>
          <ul style="color:#7a9480;line-height:2;margin:0 0 12px;padding-left:20px">
            <li>📋 <strong style="color:#e8f0e9">List your home</strong> — AI writes your listing, prices your home, explains every offer</li>
            <li>📊 <strong style="color:#e8f0e9">Get an AI price estimate</strong> — instant market analysis for your area</li>
            <li>🤝 <strong style="color:#e8f0e9">Find a certified agent</strong> — guaranteed closing rebate at closing</li>
            <li>🔍 <strong style="color:#e8f0e9">Search listings</strong> — browse homes across Canada & the USA</li>
          </ul>
          <p style="color:#3ef07a;font-weight:700;margin:0 0 20px">The power is in your hands. 💪</p>
          <a href="https://listdirect.ai/dashboard.html" style="background:#3ef07a;color:#0a0f0d;padding:12px 28px;border-radius:50px;text-decoration:none;font-weight:700;display:inline-block;margin-bottom:20px">Go to My Account →</a>
          <p style="color:#7a9480;font-size:0.85rem;margin:0">Questions? Reply to this email or reach us at infolistdirect@gmail.com</p>
          <p style="color:#7a9480;font-size:0.85rem;margin:8px 0 0">— The ListDirect Team</p>
        `)
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
    const { data: profile } = await db.from('profiles').select('*').eq('id', user.id).single();
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
      city: body.city || (body.address ? body.address.split(',').slice(1,2).join('').trim() : ''),
      state: body.state || (body.address ? body.address.split(',').slice(2,3).join('').trim().split(' ')[0] : ''),
      zip: body.zip || '',
      lat: body.lat ? parseFloat(body.lat) : null,
      lng: body.lng ? parseFloat(body.lng) : null,
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
      listing_path: body.listing_path || 'direct',
      cashback_offer: body.cashback_offer || null
    };
    // Use user-scoped client so RLS policies recognize the authenticated user
    const userClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } }
    });
    const { data, error } = await db.from('listings').insert([listing]).select().single();
    if (error) return res.status(400).json({ error: error.message });
    // Notify admin of new listing
    await sendEmail({
      to: 'infolistdirect@gmail.com',
      subject: '🏠 New Listing — ' + (listing.address || 'Unknown address'),
      html: emailWrap(`
        <h2 style="color:#3ef07a;margin:0 0 8px">New Home Listed!</h2>
        <p style="color:#7a9480;margin:0 0 20px">A seller just listed their home on ListDirect.</p>
        <div style="background:#141c16;border:1px solid #1f2d22;border-radius:12px;padding:20px;margin-bottom:16px">
          <p style="color:#e8f0e9;margin:0 0 8px"><strong style="color:#3ef07a">Address:</strong> ${listing.address}</p>
          <p style="color:#e8f0e9;margin:0 0 8px"><strong style="color:#3ef07a">Price:</strong> $${parseInt(listing.price||0).toLocaleString()}</p>
          <p style="color:#e8f0e9;margin:0 0 8px"><strong style="color:#3ef07a">Beds/Baths:</strong> ${listing.bedrooms||0} bed · ${listing.bathrooms||0} bath</p>
          <p style="color:#e8f0e9;margin:0"><strong style="color:#3ef07a">Type:</strong> ${listing.listing_path || 'direct'}</p>
        </div>
        <a href="https://listdirect.ai/admin.html" style="background:#3ef07a;color:#0a0f0d;padding:12px 28px;border-radius:50px;text-decoration:none;font-weight:700;display:inline-block">View Admin →</a>
      `)
    }).catch(() => {});

    // Send confirmation email to seller
    const sellerEmail = user.email;
    if (sellerEmail) {
      const now = new Date();
      const ts = now.toLocaleDateString('en-CA', {month:'short',day:'numeric'}) + ' ' + now.toLocaleTimeString('en-CA', {hour:'2-digit',minute:'2-digit',hour12:true});
      await sendEmail({
        to: sellerEmail,
        subject: '🎉 Your listing is live on ListDirect! · ' + ts,
        html: emailWrap(`
          <h2 style="color:#3ef07a;margin:0 0 8px">Your listing is live! 🎉</h2>
          <p style="color:#7a9480;margin:0 0 20px">Congratulations — your home is now listed on ListDirect and visible to buyers.</p>
          <div style="background:#141c16;border:1px solid #1f2d22;border-radius:12px;padding:20px;margin-bottom:16px">
            <p style="color:#e8f0e9;margin:0 0 8px"><strong style="color:#3ef07a">Address:</strong> ${listing.address}</p>
            <p style="color:#e8f0e9;margin:0 0 8px"><strong style="color:#3ef07a">Price:</strong> $${parseInt(listing.price||0).toLocaleString()}</p>
            <p style="color:#e8f0e9;margin:0"><strong style="color:#3ef07a">Platform fee:</strong> 1% at closing only</p>
          </div>
          <a href="https://listdirect.ai/dashboard.html" style="background:#3ef07a;color:#0a0f0d;padding:12px 28px;border-radius:50px;text-decoration:none;font-weight:700;display:inline-block">View My Listing →</a>
        `)
      }).catch(() => {});
    }

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
    const { data, error } = await db.from('listings').select('*').eq('user_id', user.id).order('created_at', { ascending: false });
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Photos: Upload ────────────────────────────────────────────
app.post('/api/photos/upload', upload.single('photo'), async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  try {
    // Get user ID if logged in, otherwise use 'anonymous'
    let userId = 'anonymous';
    if (token) {
      const { data: { user } } = await supabase.auth.getUser(token);
      if (user) userId = user.id;
    }
    const file = req.file;
    const fileName = `${userId}/${Date.now()}-${file.originalname}`;
    const { data, error } = await db.storage.from('listing-photos').upload(fileName, file.buffer, {
      contentType: file.mimetype, upsert: false
    });
    if (error) return res.status(400).json({ error: error.message });
    const { data: { publicUrl } } = db.storage.from('listing-photos').getPublicUrl(fileName);
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
    const { data, error } = await db.from('favorites').upsert([{ user_id: user.id, listing_id }]).select();
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
    const { data, error } = await db.from('favorites').select('*').eq('user_id', user.id);
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
    const { error } = await db.from('favorites').delete().eq('user_id', user.id).eq('listing_id', req.params.listing_id);
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
    const { error: profErr } = await db.from('profiles')
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
    const { error: upErr } = await db.storage.from('agent-avatars').upload(fileName, file.buffer, {
      contentType: file.mimetype, upsert: true
    });
    if (upErr) return res.status(400).json({ error: upErr.message });
    const { data: { publicUrl } } = db.storage.from('agent-avatars').getPublicUrl(fileName);
    await db.from('profiles').update({ avatar_url: publicUrl }).eq('id', user.id);
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

// ── Lead Capture (non-verified listings) ─────────────────────
app.post('/api/lead-capture', async (req, res) => {
  const { name, email, phone, address, price, source, message } = req.body;
  const isAgentReq = source === 'agent-request';
  try {
    await sendEmail({
      to: 'infolistdirect@gmail.com',
      subject: isAgentReq ? '🤝 New Agent Request — ' + (address || 'Unknown area') : '🔔 New Buyer Lead — ' + address,
      html: emailWrap(`
        <h2 style="color:#3ef07a;margin:0 0 8px">${isAgentReq ? 'New Agent Request!' : 'New Buyer Lead!'}</h2>
        <p style="color:#7a9480;margin:0 0 20px">${isAgentReq ? 'Someone is looking for a certified agent through ListDirect.' : 'Someone is interested in a property on ListDirect.'}</p>
        <div style="background:#141c16;border:1px solid #1f2d22;border-radius:12px;padding:20px;margin-bottom:16px">
          <p style="color:#e8f0e9;margin:0 0 8px"><strong style="color:#3ef07a">Name:</strong> ${name}</p>
          <p style="color:#e8f0e9;margin:0 0 8px"><strong style="color:#3ef07a">Email:</strong> ${email}</p>
          <p style="color:#e8f0e9;margin:0 0 8px"><strong style="color:#3ef07a">Phone:</strong> ${phone || 'Not provided'}</p>
          <p style="color:#e8f0e9;margin:0 0 8px"><strong style="color:#3ef07a">${isAgentReq ? 'Area' : 'Property'}:</strong> ${address || 'Not specified'}</p>
          ${!isAgentReq && price ? `<p style="color:#e8f0e9;margin:0 0 8px"><strong style="color:#3ef07a">Price:</strong> $${parseInt(price).toLocaleString()}</p>` : ''}
          ${message ? `<p style="color:#e8f0e9;margin:0"><strong style="color:#3ef07a">Property Details:</strong> ${message}</p>` : ''}
        </div>
        <a href="mailto:${email}" style="background:#3ef07a;color:#0a0f0d;padding:12px 28px;border-radius:50px;text-decoration:none;font-weight:700;display:inline-block">Reply to ${name} →</a>
      `)
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Admin: Stats ─────────────────────────────────────────────
app.get('/api/admin/stats', async (req, res) => {
  const key = req.headers['x-admin-key'];
  if (!adminAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const adminSupabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    // Total users
    const { data: { users } } = await adminSupabase.auth.admin.listUsers({ perPage: 1000 });
    const totalUsers = users ? users.length : 0;
    const sellers = users ? users.filter(u => !u.user_metadata?.role || u.user_metadata?.role === 'seller').length : 0;
    const agents = users ? users.filter(u => u.user_metadata?.role === 'agent').length : 0;
    // Total listings
    const { count: totalListings } = await adminSupabase.from('listings').select('*', { count: 'exact', head: true });
    const { count: activeListings } = await adminSupabase.from('listings').select('*', { count: 'exact', head: true }).eq('status', 'active');
    // Total payments
    const { data: payments } = await adminSupabase.from('payments').select('amount');
    const totalRevenue = payments ? payments.reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0) : 0;
    res.json({ totalUsers, sellers, agents, totalListings, activeListings, totalRevenue });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Admin: All Listings ────────────────────────────
app.get('/api/admin/listings', async (req, res) => {
  const key = req.headers['x-admin-key'];
  if (!adminAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { data, error } = await db.from('listings').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ listings: data || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Admin: All Users ──────────────────────────────────────────
app.get('/api/admin/users', async (req, res) => {
  const key = req.headers['x-admin-key'];
  if (!adminAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const adminSupabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const { data: { users }, error } = await adminSupabase.auth.admin.listUsers({ perPage: 1000 });
    if (error) throw error;
    res.json({ users: users || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Get Certified Agents ──────────────────────────────────────
app.get('/api/agents', async (req, res) => {
  try {
    const { data, error } = await db
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

// ── Agent: Get my leads ───────────────────────────────────────
app.get('/api/leads/mine', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const { data: { user } } = await supabase.auth.getUser(token);
    if (!user) return res.status(401).json({ error: 'Invalid token' });
    const leadClient = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY
    );
    const { data, error } = await leadClient
      .from('leads')
      .select('*')
      .eq('agent_id', user.id)
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ leads: data || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ── Admin: Get All Agents ─────────────────────────────────────
app.get('/api/admin/agents', async (req, res) => {
  const adminKey = req.headers['x-admin-key'];
  if (!adminAuth(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    // Get all agent profiles with their auth email
    const { data: profiles, error } = await db
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

// ── Buyer Capture (calculator/qualifier email opt-in) ─────────
app.post('/api/buyer-capture', async (req, res) => {
  const { email, tool, price, savings, country, qualified, location } = req.body;
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'Valid email required' });
  try {
    // Save the buyer prospect
    const bClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY);
    await bClient.from('buyer_prospects').insert({
      email, tool: tool || '', price: price ? String(price) : '',
      savings: savings || '', country: country || '', location: location || '',
      status: 'new'
    }).then(()=>{}).catch(()=>{});

    // Send them their personalized breakdown
    const cur = country === 'ca' ? 'CAD' : 'USD';
    const p = parseInt(price) || 0;
    const fmt = n => '$' + n.toLocaleString() + ' ' + cur;
    let emailHtml;
    if (tool === 'mortgage-qualifier') {
      const breakdownHtml = (req.body.breakdown || '')
        .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
        .replace(/\n/g,'<br>');
      emailHtml = emailWrap(`
        <h2 style="color:#3ef07a;margin:0 0 8px">Your mortgage qualification breakdown 🏡</h2>
        <p style="color:#7a9480;margin:0 0 20px">Here's the full assessment from your ListDirect qualifier:</p>
        ${breakdownHtml ? `<div style="background:#141c16;border:1px solid #1f2d22;border-radius:12px;padding:20px;margin-bottom:16px;color:#e8f0e9;line-height:1.7;font-size:0.9rem">${breakdownHtml}</div>` : `<div style="background:#141c16;border:1px solid #1f2d22;border-radius:12px;padding:20px;margin-bottom:16px"><p style="color:#e8f0e9;margin:0">Your full assessment is on our site.</p></div>`}
        <div style="background:#1a3d28;border:1px solid rgba(62,240,122,0.3);border-radius:12px;padding:16px;margin-bottom:16px">
          <p style="color:#3ef07a;font-weight:700;margin:0 0 4px">💰 Buyer bonus</p>
          <p style="color:#e8f0e9;margin:0;font-size:0.9rem">As a buyer through ListDirect, you can get a closing rebate on certain listings — thousands back in your pocket.</p>
        </div>
        <a href="https://listdirect.ai" style="background:#3ef07a;color:#0a0f0d;padding:12px 28px;border-radius:50px;text-decoration:none;font-weight:700;display:inline-block">Browse Listings →</a>
        <p style="color:#7a9480;font-size:0.75rem;margin:16px 0 0;line-height:1.5">This is general guidance only, not a mortgage approval or financial advice. Always consult a licensed mortgage broker for an official assessment.</p>
      `);
    } else {
      emailHtml = emailWrap(`
        <h2 style="color:#3ef07a;margin:0 0 8px">Your savings breakdown 💰</h2>
        <p style="color:#7a9480;margin:0 0 20px">Here's what you'd keep by selling with ListDirect.</p>
        <div style="background:#141c16;border:1px solid #1f2d22;border-radius:12px;padding:20px;margin-bottom:16px">
          <p style="color:#e8f0e9;margin:0 0 8px"><strong style="color:#3ef07a">On a ${fmt(p)} home:</strong></p>
          <p style="color:#e8f0e9;margin:0 0 6px">Traditional agent (up to 6%): ${fmt(Math.round(p*0.06))}</p>
          <p style="color:#e8f0e9;margin:0 0 6px">ListDirect (1%): ${fmt(Math.round(p*0.01))}</p>
          <p style="color:#3ef07a;font-weight:700;margin:8px 0 0">You keep about ${savings || fmt(Math.round(p*0.05))} more.</p>
        </div>
        <a href="https://listdirect.ai/listdirect-list.html" style="background:#3ef07a;color:#0a0f0d;padding:12px 28px;border-radius:50px;text-decoration:none;font-weight:700;display:inline-block">Start My Listing →</a>
      `);
    }
    await sendEmail({ to: email, subject: tool === 'mortgage-qualifier' ? 'Your ListDirect home buying breakdown 🏡' : 'Your ListDirect savings breakdown 💰', html: emailHtml }).catch(()=>{});

    // Notify admin of new buyer lead
    await sendEmail({
      to: 'infolistdirect@gmail.com',
      subject: '🎯 New Buyer Lead — ' + email,
      html: emailWrap(`<h2 style="color:#3ef07a">New Buyer/Seller Lead</h2><p style="color:#e8f0e9">Email: ${email}<br>Tool: ${tool}<br>Price: ${fmt(p)}<br>Savings shown: ${savings||'—'}</p>`)
    }).catch(()=>{});

    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Admin: Prospects (Seller Prospecting Engine) ──────────────
// ── Admin auth (signed, expiring token — no password stored in the browser) ──
// The admin password lives ONLY in process.env.ADMIN_KEY on the server.
// /api/admin/login verifies it and hands back a short-lived signed token;
// every admin endpoint validates that token here. The password itself is
// never embedded in admin.html and never sent on normal requests.
const ADMIN_SESSION_MS = 8 * 60 * 60 * 1000; // 8 hours

// The admin secret can be set in Render under either name — ADMIN_KEY or
// ADMIN_PASSWORD — so you don't have to rename an existing variable.
function adminSecret() {
  return process.env.ADMIN_KEY || process.env.ADMIN_PASSWORD || '';
}

function mintAdminToken() {
  const secret = adminSecret();
  const exp = Date.now() + ADMIN_SESSION_MS;
  const sig = crypto.createHmac('sha256', secret).update(String(exp)).digest('hex');
  return `${exp}.${sig}`;
}

function adminAuth(req) {
  const secret = adminSecret();
  if (!secret) return false; // fail closed if no admin password is configured
  const tok = req.headers['x-admin-key'];
  if (!tok || typeof tok !== 'string' || tok.indexOf('.') === -1) return false;
  const [expStr, sig] = tok.split('.');
  const exp = parseInt(expStr, 10);
  if (!exp || Date.now() > exp) return false;
  const expected = crypto.createHmac('sha256', secret).update(String(exp)).digest('hex');
  if (!sig || sig.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'));
  } catch (e) {
    return false;
  }
}

app.post('/api/admin/login', (req, res) => {
  const secret = adminSecret();
  if (!secret) return res.status(500).json({ error: 'Admin login is not configured.' });
  const password = (req.body && req.body.password) || '';
  // constant-time comparison of the submitted password against the secret
  const a = Buffer.from(String(password));
  const b = Buffer.from(String(secret));
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!ok) return res.status(401).json({ error: 'Incorrect password' });
  res.json({ token: mintAdminToken() });
});
function prospectClient() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY);
}

app.get('/api/admin/prospects', async (req, res) => {
  if (!adminAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { data, error } = await prospectClient()
      .from('prospects').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ prospects: data || [] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/admin/buyers', async (req, res) => {
  if (!adminAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { data, error } = await prospectClient()
      .from('buyer_prospects').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ buyers: data || [] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Bulk import prospects (from CSV)
app.post('/api/admin/prospects/bulk', async (req, res) => {
  if (!adminAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
  const rows = Array.isArray(req.body.prospects) ? req.body.prospects : [];
  if (!rows.length) return res.status(400).json({ error: 'No rows' });
  try {
    const clean = rows.slice(0, 500).map(r => ({
      owner_name: (r.owner_name || '').toString().slice(0,200),
      address: (r.address || '').toString().slice(0,300),
      price: (r.price || '').toString().slice(0,50),
      contact: (r.contact || '').toString().slice(0,200),
      source: (r.source || 'CSV import').toString().slice(0,100),
      market: (r.market || 'San Antonio, TX').toString().slice(0,100),
      status: 'new'
    })).filter(r => r.address || r.contact);
    const { data, error } = await prospectClient().from('prospects').insert(clean).select();
    if (error) throw error;
    res.json({ added: (data || []).length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Fetch FSBO prospects from Craigslist San Antonio (real estate by owner)
app.post('/api/admin/prospects/craigslist', async (req, res) => {
  if (!adminAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const url = 'https://sanantonio.craigslist.org/search/reo?format=rss';
    const r = await fetch(url, { headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1'
    } });
    if (!r.ok) return res.status(502).json({ error: 'Craigslist returned ' + r.status + ' — they are blocking automated access. Use the CSV import route instead.' });
    const xml = await r.text();
    // Parse RSS items
    const items = [];
    const itemBlocks = xml.split('<item');
    for (let i = 1; i < itemBlocks.length && items.length < 50; i++) {
      const block = itemBlocks[i];
      const titleMatch = block.match(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/s);
      const linkMatch = block.match(/<link>(.*?)<\/link>/s) || block.match(/rdf:resource="(.*?)"/);
      let title = titleMatch ? titleMatch[1].trim() : '';
      const link = linkMatch ? linkMatch[1].trim() : '';
      // Extract price from title if present ($xxx,xxx)
      const priceMatch = title.match(/\$([0-9,]{4,})/);
      const price = priceMatch ? priceMatch[1].replace(/,/g,'') : '';
      // Clean title of price for address/name
      title = title.replace(/\$[0-9,]+/,'').trim();
      if (title) items.push({
        owner_name: '',
        address: title.slice(0,300),
        price: price,
        contact: link,
        source: 'Craigslist',
        market: 'San Antonio, TX',
        status: 'new'
      });
    }
    if (!items.length) return res.json({ added: 0, note: 'No listings found (Craigslist may have changed format or blocked the request)' });
    const { data, error } = await prospectClient().from('prospects').insert(items).select();
    if (error) throw error;
    res.json({ added: (data || []).length });
  } catch (err) { res.status(500).json({ error: 'Craigslist fetch failed: ' + err.message }); }
});

app.post('/api/admin/prospects', async (req, res) => {
  if (!adminAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
  const { owner_name, address, price, contact, source, market } = req.body;
  try {
    const { data, error } = await prospectClient().from('prospects').insert({
      owner_name: owner_name || '', address: address || '', price: price || '',
      contact: contact || '', source: source || 'manual', market: market || '',
      status: 'new'
    }).select();
    if (error) throw error;
    res.json({ prospect: data && data[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.patch('/api/admin/prospects/:id', async (req, res) => {
  if (!adminAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { error } = await prospectClient().from('prospects').update(req.body).eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/prospects/send-outreach', async (req, res) => {
  if (!adminAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
  const { id, email, owner_name, address, price } = req.body;
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'No valid email' });
  try {
    const p = parseInt((price||'').toString().replace(/[^0-9]/g,'')) || 0;
    const fmt = n => '$' + n.toLocaleString();
    const savings = Math.round(p * 0.05);
    const firstName = (owner_name || '').split(' ')[0] || 'there';
    const html = emailWrap(`
      <h2 style="color:#3ef07a;margin:0 0 6px">Selling your home? Keep ${fmt(savings)} more 💰</h2>
      <p style="color:#7a9480;margin:0 0 20px">Hi ${firstName}, I saw your home listed for sale by owner${address ? ' at ' + address : ''}.</p>
      <p style="color:#e8f0e9;margin:0 0 16px;line-height:1.6">Selling on your own is smart — and ListDirect makes it even easier while saving you thousands. Our AI handles your pricing, writes your listing, and walks you through every offer.</p>
      <div style="background:#141c16;border:1px solid #1f2d22;border-radius:12px;padding:20px;margin-bottom:20px">
        <p style="color:#7a9480;margin:0 0 4px;font-size:0.85rem">On your ${fmt(p)} home</p>
        <p style="color:#e8f0e9;margin:0 0 6px">Traditional agent (6%): <strong>${fmt(Math.round(p*0.06))}</strong></p>
        <p style="color:#e8f0e9;margin:0 0 6px">ListDirect (1%): <strong style="color:#3ef07a">${fmt(Math.round(p*0.01))}</strong></p>
        <p style="color:#3ef07a;font-weight:700;margin:8px 0 0;font-size:1.1rem">You keep about ${fmt(savings)} more.</p>
      </div>
      <a href="https://listdirect.ai" style="background:#3ef07a;color:#0a0f0d;padding:12px 28px;border-radius:50px;text-decoration:none;font-weight:700;display:inline-block;margin-bottom:16px">Get a Free AI Price Estimate →</a>
      <p style="color:#7a9480;font-size:0.85rem;margin:0">No obligation — just reply to this email with any questions.</p>
      <p style="color:#7a9480;font-size:0.85rem;margin:8px 0 0">— Harvy Chahal, Founder, ListDirect</p>
      <div style="border-top:1px solid #1f2d22;margin-top:20px;padding-top:14px">
        <p style="color:#3a4d3e;font-size:0.72rem;line-height:1.5;margin:0">You received this because your property was listed publicly for sale by owner. ListDirect, 10265 238A St, Maple Ridge, BC, Canada. If you'd prefer not to receive these, just reply "unsubscribe" and we won't contact you again.</p>
      </div>
    `);
    await sendEmail({
      to: email,
      subject: `Selling your home? Keep ${fmt(savings)} more`,
      html,
      reply_to: 'infolistdirect@gmail.com'
    });
    // Mark contacted
    if (id) await prospectClient().from('prospects').update({ status: 'contacted' }).eq('id', id).then(()=>{}).catch(()=>{});
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/admin/prospects/clear', async (req, res) => {
  if (!adminAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { data, error } = await prospectClient().from('prospects').delete().neq('id', '00000000-0000-0000-0000-000000000000').select();
    if (error) throw error;
    res.json({ deleted: (data || []).length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/admin/prospects/:id', async (req, res) => {
  if (!adminAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { error } = await prospectClient().from('prospects').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Admin: Update Agent ───────────────────────────────────────
app.patch('/api/admin/agents/:id', async (req, res) => {
  const adminKey = req.headers['x-admin-key'];
  if (!adminAuth(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const { id } = req.params;
  const updates = req.body;
  try {
    const adminClient = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY
    );
    const { error } = await adminClient
      .from('profiles')
      .update(updates)
      .eq('id', id);
    if (error) throw error;
    
    // If agent was just approved, send them a welcome email
    if (updates.approved === true) {
      const { data: profile } = await db.from('profiles').select('*').eq('id', id).single();
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
    await db.from('payments').insert({
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
    
    await db.from('payments').insert({
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
  if (!adminAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
  const { payment_id } = req.body;
  try {
    const { error } = await db.from('payments').update({ status: 'paid' }).eq('id', payment_id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Get Payments (Admin) ──────────────────────────────────────
app.get('/api/admin/payments', async (req, res) => {
  const adminKey = req.headers['x-admin-key'];
  if (!adminAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { data, error } = await db.from('payments').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ payments: data || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ── Notify: Agent Request ─────────────────────────────────────
app.post('/api/notify/agent-request', async (req, res) => {
  const { agent_id, agent_name, agent_email, seller_name, seller_email, seller_phone, seller_address, seller_price, cashback } = req.body;
  try {
    // Save the lead to the database so the agent sees it in their portal
    if (agent_id) {
      const leadClient = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY
      );
      await leadClient.from('leads').insert({
        agent_id,
        seller_name: seller_name || '',
        seller_email: seller_email || '',
        seller_phone: seller_phone || '',
        seller_address: seller_address || '',
        seller_price: seller_price || '',
        status: 'new'
      }).then(() => {}).catch(() => {});
    }
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
    const { data: listing } = await db.from('listings').select('view_count').eq('id', req.params.id).single();
    const currentViews = listing?.view_count || 0;
    await db.from('listings').update({ view_count: currentViews + 1 }).eq('id', req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false });
  }
});

// ── Listings: Update ──────────────────────────────────────────
app.delete('/api/listings/:id', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const { data: { user } } = await supabase.auth.getUser(token);
    if (!user) return res.status(401).json({ error: 'Invalid token' });
    const { id } = req.params;
    const { error } = await db.from('listings').delete().eq('id', id).eq('user_id', user.id);
    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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
    const { data, error } = await db
      .from('listings')
      .update(updates)
      .eq('id', id)
      .eq('user_id', user.id)
      .select();
    if (error) return res.status(400).json({ error: error.message });
    if (!data || data.length === 0) return res.status(404).json({ error: 'Listing not found or not yours' });
    res.json(data[0]);
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
    await db.from('messages').insert([{
      seller_id,
      sender_name: buyer_name,
      sender_email: buyer_email,
      message: `💰 OFFER: $${parseInt(offer_amount).toLocaleString()}\n\nProperty: ${property}\nPhone: ${buyer_phone || 'Not provided'}\n\n${message ? 'Note: ' + message : ''}`,
      read: false,
      created_at: new Date().toISOString()
    }]);

    // Notify seller + ListDirect via email
    const adminClient2 = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY);
    const { data: offerSellerAuth } = await adminClient2.auth.admin.getUserById(seller_id).catch(() => ({ data: null }));
    const offerSellerEmail = offerSellerAuth?.user?.email;
    const offerHtml = emailWrap(`
      <h2 style="color:#3ef07a;margin:0 0 8px">💰 New Offer Received!</h2>
      <p style="color:#7a9480;margin:0 0 20px">An offer was submitted on a ListDirect listing.</p>
      <div style="background:#1a3d28;border:1px solid rgba(62,240,122,0.3);border-radius:12px;padding:20px;margin-bottom:16px;text-align:center">
        <div style="font-size:0.85rem;color:#7a9480;margin-bottom:4px">Offer Amount</div>
        <div style="font-family:'Georgia',serif;font-size:2.5rem;font-weight:900;color:#3ef07a">$${parseInt(offer_amount).toLocaleString()}</div>
      </div>
      <div style="background:#141c16;border:1px solid #1f2d22;border-radius:12px;padding:20px;margin-bottom:16px">
        <p style="color:#e8f0e9;margin:0 0 8px"><strong style="color:#3ef07a">Property:</strong> ${property}</p>
        <p style="color:#e8f0e9;margin:0 0 8px"><strong style="color:#3ef07a">Buyer Name:</strong> ${buyer_name}</p>
        <p style="color:#e8f0e9;margin:0 0 8px"><strong style="color:#3ef07a">Buyer Email:</strong> ${buyer_email}</p>
        ${buyer_phone ? `<p style="color:#e8f0e9;margin:0 0 8px"><strong style="color:#3ef07a">Phone:</strong> ${buyer_phone}</p>` : ''}
        ${message ? `<p style="color:#e8f0e9;margin:0"><strong style="color:#3ef07a">Note:</strong> ${message}</p>` : ''}
      </div>
      <a href="mailto:${buyer_email}" style="background:#3ef07a;color:#0a0f0d;padding:12px 28px;border-radius:50px;text-decoration:none;font-weight:700;display:inline-block;margin-right:10px">Reply to ${buyer_name} →</a>
      <a href="https://listdirect.ai/dashboard.html" style="background:none;border:1px solid rgba(62,240,122,0.4);color:#3ef07a;padding:12px 28px;border-radius:50px;text-decoration:none;font-weight:700;display:inline-block">View in Dashboard →</a>
    `);
    const offerNow = new Date(); const offerTs = offerNow.toLocaleDateString('en-CA',{month:'short',day:'numeric'}) + ' ' + offerNow.toLocaleTimeString('en-CA',{hour:'2-digit',minute:'2-digit',hour12:true});
    const offerSubject = `💰 New Offer — $${parseInt(offer_amount).toLocaleString()} on ${property} · ${offerTs}`;
    if (offerSellerEmail) await sendEmail({ to: offerSellerEmail, reply_to: buyer_email, subject: offerSubject, html: offerHtml }).catch(e => console.error('Seller offer notify:', e.message));
    if (offerSellerEmail !== 'infolistdirect@gmail.com') await sendEmail({ to: 'infolistdirect@gmail.com', reply_to: buyer_email, subject: offerSubject, html: offerHtml }).catch(e => console.error('LD offer notify:', e.message));
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

    const { data, error } = await db.from('messages').insert([{
      listing_id: validListingId,
      seller_id: validSellerId,
      sender_id,
      sender_name, sender_email, message, read: false
    }]).select().single();
    if (error) return res.status(400).json({ error: error.message });

    // Notify seller + ListDirect via email
    const adminClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY);
    const { data: sellerAuth } = await adminClient.auth.admin.getUserById(validSellerId || seller_id).catch(() => ({ data: null }));
    const sellerEmail = sellerAuth?.user?.email;
    const msgHtml = emailWrap(`
      <h2 style="color:#3ef07a;margin:0 0 8px">💬 New Message!</h2>
      <p style="color:#7a9480;margin:0 0 20px">Someone is interested in a ListDirect property.</p>
      <div style="background:#141c16;border:1px solid #1f2d22;border-radius:12px;padding:20px;margin-bottom:16px">
        <p style="color:#e8f0e9;margin:0 0 8px"><strong style="color:#3ef07a">From:</strong> ${sender_name}</p>
        <p style="color:#e8f0e9;margin:0 0 8px"><strong style="color:#3ef07a">Email:</strong> ${sender_email}</p>
        <p style="color:#e8f0e9;margin:0"><strong style="color:#3ef07a">Message:</strong> "${message}"</p>
      </div>
      <a href="mailto:${sender_email}" style="background:#3ef07a;color:#0a0f0d;padding:12px 28px;border-radius:50px;text-decoration:none;font-weight:700;display:inline-block;margin-right:10px">Reply to ${sender_name} →</a>
      <a href="https://listdirect.ai/dashboard.html" style="background:none;border:1px solid rgba(62,240,122,0.4);color:#3ef07a;padding:12px 28px;border-radius:50px;text-decoration:none;font-weight:700;display:inline-block">View in Dashboard →</a>
    `);
    const now = new Date(); const ts = now.toLocaleDateString('en-CA',{month:'short',day:'numeric'}) + ' ' + now.toLocaleTimeString('en-CA',{hour:'2-digit',minute:'2-digit',hour12:true});
    const msgSubject = '💬 New Message — ' + sender_name + ' is interested in a listing! · ' + ts;
    if (sellerEmail) await sendEmail({ to: sellerEmail, reply_to: sender_email, subject: msgSubject, html: msgHtml }).catch(e => console.error('Seller msg notify:', e.message));
    if (sellerEmail !== 'infolistdirect@gmail.com') await sendEmail({ to: 'infolistdirect@gmail.com', reply_to: sender_email, subject: msgSubject, html: msgHtml }).catch(e => console.error('LD msg notify:', e.message));

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
    const { data, error } = await db
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
    const { data: profile } = await db.from('profiles').select('full_name, email').eq('id', user.id).single();
    const sellerName = profile?.full_name || 'The Seller';
    const sellerEmail = user.email || profile?.email || 'infolistdirect@gmail.com';
    console.log('Seller email for reply-to:', sellerEmail);

    // Store reply in Supabase
    const { error: replyError } = await db.from('message_replies').insert([{
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
    await db.from('messages').update({ read: true }).eq('id', original_message_id);

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
    const { data, error } = await db.from('message_replies')
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
    await db.from('messages').update({ read: true }).eq('id', req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/messages/:id', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const { data: { user } } = await supabase.auth.getUser(token);
    if (!user) return res.status(401).json({ error: 'Invalid token' });
    await db.from('messages').delete().eq('id', req.params.id).eq('seller_id', user.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ── Listings: Search Public ───────────────────────────────────
app.get('/api/listings/search', async (req, res) => {
  const { q, beds, maxPrice } = req.query;
  try {
    let query = db
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
    const { count: sellerCount } = await db
      .from('profiles')
      .select('*', { count: 'exact', head: true })
      .eq('role', 'seller');
    const { count: agentCount } = await db
      .from('profiles')
      .select('*', { count: 'exact', head: true })
      .eq('role', 'agent');
    res.json({ sellers: sellerCount || 0, agents: agentCount || 0, count: (sellerCount || 0) + (agentCount || 0) });
  } catch (err) {
    res.json({ sellers: 0, agents: 0, count: 0 });
  }
});


// ── MLS Cache ───────────────────────────────────────────────
const mlsCache = new Map();
const MLS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// ── Bridge MLS Listings (Canada — GVR/FVREB via BridgeAPI) ───
app.get('/api/mls/canada', async (req, res) => {
  const { city, minBeds, maxPrice, minPrice, type } = req.query;
  const cacheKey = JSON.stringify({ city, minBeds, maxPrice, minPrice, type });
  const cached = mlsCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < MLS_CACHE_TTL) {
    console.log('[MLS CACHE HIT]', cacheKey);
    res.setHeader('X-Cache', 'HIT');
    return res.json(cached.data);
  }
  console.log('[MLS CACHE MISS]', cacheKey);
  try {
    const BRIDGE_BASE = 'https://api.bridgedataoutput.com/api/v3/OData/bcres';
    const BRIDGE_TOKEN = process.env.BRIDGE_TOKEN;

    // Build OData $filter
    const filters = ["StandardStatus eq 'Active'"];
    if (city) filters.push(`City eq '${city.replace(/'/g, "''")}'`);
    if (minBeds) filters.push(`BedroomsTotal ge ${parseInt(minBeds)}`);
    if (minPrice) filters.push(`ListPrice ge ${parseInt(minPrice)}`);
    if (maxPrice) filters.push(`ListPrice le ${parseInt(maxPrice)}`);

    const params = new URLSearchParams({
      '$filter': filters.join(' and '),
      '$top': '20',
      '$orderby': 'ModificationTimestamp desc',
      '$select': 'ListingKey,ListPrice,City,PostalCode,StateOrProvince,BedroomsTotal,BathroomsTotalInteger,BathroomsFull,BathroomsHalf,LivingArea,LotSizeArea,LotSizeSquareFeet,YearBuilt,PropertyType,PropertySubType,PublicRemarks,StreetNumber,StreetName,StreetSuffix,ListingContractDate,ListOfficeMlsId,Latitude,Longitude,GarageSpaces,GarageYN,ParkingTotal,Stories,Heating,Cooling,FireplacesTotal,Media'
    });

    const response = await fetch(`${BRIDGE_BASE}/Property?${params.toString()}`, {
      headers: {
        'Authorization': `Bearer ${BRIDGE_TOKEN}`,
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Bridge API error:', response.status, err);
      return res.status(response.status).json({ error: err, listings: [] });
    }

    const data = await response.json();
    const listings = (data.value || []).map(l => {
      const addr = [l.StreetNumber, l.StreetName, l.StreetSuffix].filter(Boolean).join(' ');
      const allPhotos = (l.Media || [])
        .sort((a, b) => (a.Order || 0) - (b.Order || 0))
        .map(m => m.MediaURL)
        .filter(Boolean);
      const img = allPhotos[0] || 'https://images.unsplash.com/photo-1570129477492-45c003edd2be?w=400&h=280&fit=crop';
      const days = l.ListingContractDate
        ? Math.floor((Date.now() - new Date(l.ListingContractDate)) / 86400000)
        : 0;
      return {
        id: l.ListingKey,
        verified: false,
        platform: false,
        mls: true,
        us: false,
        price: parseInt(l.ListPrice) || 0,
        currency: 'CAD',
        addr,
        city: l.City || city || '',
        zip: l.PostalCode || '',
        beds: parseInt(l.BedroomsTotal) || 0,
        baths: parseFloat(l.BathroomsTotalInteger) || 0,
        sqft: parseInt(l.LivingArea) || 0,
        lotSize: parseInt(l.LotSizeSquareFeet || l.LotSizeArea) || 0,
        type: l.PropertyType || 'house',
        yearBuilt: l.YearBuilt || null,
        lat: l.Latitude || null,
        lng: l.Longitude || null,
        garage: l.GarageSpaces || (l.GarageYN ? 1 : 0),
        parking: l.ParkingTotal || 0,
        stories: l.Stories || null,
        heating: l.Heating || null,
        cooling: l.Cooling || null,
        fireplaces: l.FireplacesTotal || 0,
        lat: l.Latitude || null,
        lng: l.Longitude || null,
        days,
        match: Math.floor(Math.random() * 15) + 80,
        img,
        img2: allPhotos[1] || null,
        img3: allPhotos[2] || null,
        allPhotos,
        cashback: null,
        desc: l.PublicRemarks || '',
        office: l.ListOfficeName || 'Member Brokerage',
        listing: 'mls'
      };
    });

    mlsCache.set(cacheKey, { data: { listings }, ts: Date.now() });
    res.json({ listings });
  } catch (err) {
    console.error('Bridge API error:', err.message);
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

// ── Pricing Data: US (Rentcast AVM) + Canada (Repliers active) ──
app.get('/api/pricing-data', async (req, res) => {
  const { address, city, state, country, beds, sqft } = req.query;
  try {
    if (country === 'Canada' || country === 'CA') {
      // Canada — pull active listings from Repliers for comparable range
      const params = new URLSearchParams({ limit: '10', sortBy: 'updatedOnDesc' });
      if (city) params.append('city', city);
      if (beds) params.append('minBeds', String(parseInt(beds) - 1));
      if (beds) params.append('maxBeds', String(parseInt(beds) + 1));
      const response = await fetch(`https://api.repliers.io/listings?${params.toString()}`, {
        headers: { 'repliers-api-key': process.env.REPLIERS_API_KEY, 'Content-Type': 'application/json' }
      });
      if (!response.ok) return res.json({ comps: null });
      const data = await response.json();
      const listings = (data.listings || []).slice(0, 8);
      const prices = listings.map(l => parseInt(l.listPrice)).filter(p => p > 0);
      const avgPrice = prices.length ? Math.round(prices.reduce((a,b) => a+b, 0) / prices.length) : null;
      const minPrice = prices.length ? Math.min(...prices) : null;
      const maxPrice = prices.length ? Math.max(...prices) : null;
      res.json({ source: 'repliers', type: 'active', avgPrice, minPrice, maxPrice, count: prices.length, listings: listings.slice(0,5).map(l => ({ address: l.address?.streetNumber + ' ' + l.address?.streetName, price: l.listPrice, beds: l.details?.numBedrooms, sqft: l.details?.sqft })) });
    } else {
      // US — use Rentcast AVM for estimated value
      if (!address) return res.json({ comps: null });
      const params = new URLSearchParams({ address: address + (city ? ', ' + city : '') + (state ? ', ' + state : ''), bedrooms: beds || '', squareFootage: sqft || '' });
      const response = await fetch(`https://api.rentcast.io/v1/avm/value?${params.toString()}`, {
        headers: { 'X-Api-Key': process.env.RENTCAST_API_KEY, 'accept': 'application/json' }
      });
      if (!response.ok) return res.json({ comps: null });
      const data = await response.json();
      res.json({ source: 'rentcast', type: 'avm', estimatedValue: data.price, priceRangeLow: data.priceLow, priceRangeHigh: data.priceHigh, comparables: (data.comparables || []).slice(0, 5).map(c => ({ address: c.formattedAddress, price: c.price, beds: c.bedrooms, sqft: c.squareFootage, distance: c.distance })) });
    }
  } catch (err) {
    res.json({ comps: null, error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════
//  AI OFFER & NEGOTIATION ENGINE
//  Safety model (all enforced server-side):
//   1. Seller's private rules (offer_rules) are NEVER sent to buyers.
//   2. The AI only DRAFTS. Nothing reaches the buyer until the seller sends it.
//   3. The AI's counter can never be BELOW the seller's minimum (the seller
//      may still type any number manually).
//   4. If the AI's buyer-facing message mentions a private price, it's rewritten.
//   5. Buyers only ever see their own offers, with AI-draft fields stripped.
//   6. Every step is logged in offer_events.
// ════════════════════════════════════════════════════════════════

async function getAuthUser(req) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return null;
  try { const { data: { user } } = await supabase.auth.getUser(token); return user || null; }
  catch (e) { return null; }
}

async function logOfferEvent(offerId, actor, event, detail) {
  try { await db.from('offer_events').insert([{ offer_id: offerId, actor, event, detail: detail || {} }]); }
  catch (e) { console.error('offer_event log failed:', e.message); }
}

// Keep the ListDirect owner in the loop on every step of a negotiation.
const ADMIN_NOTIFY_EMAIL = process.env.ADMIN_NOTIFY_EMAIL || 'infolistdirect@gmail.com';
async function notifyAdmin(subject, lines) {
  try {
    const html = emailWrap('<h2 style="color:#3ef07a;margin:0 0 10px">📋 Offer activity</h2>' +
      (lines || []).map(function (l) { return '<p style="color:#e8f0e9;margin:0 0 6px">' + l + '</p>'; }).join(''));
    await sendEmail({ to: ADMIN_NOTIFY_EMAIL, subject: '[ListDirect] ' + subject, html });
  } catch (e) { /* best-effort */ }
}

// Only these fields are ever exposed to a BUYER (safety 1 & 5).
function offerForBuyer(o) {
  if (!o) return o;
  return {
    id: o.id, listing_id: o.listing_id, property: o.property,
    price: o.price, deposit: o.deposit, closing_date: o.closing_date,
    conditions: o.conditions, buyer_message: o.buyer_message, status: o.status,
    seller_action: o.seller_action || null,
    seller_counter_price: o.seller_counter_price ?? null,
    seller_message: o.seller_message || null,
    created_at: o.created_at, updated_at: o.updated_at
  };
}

// True if a buyer-facing message leaks a private number (min or target price).
function messageLeaksPrivate(message, rules) {
  if (!message || !rules) return false;
  const stripped = message.replace(/[\$,\s]/g, '');
  for (const p of [rules.min_price, rules.target_price]) {
    const n = parseInt(p);
    if (n && stripped.includes(String(n))) return true;
  }
  return false;
}

// Safe, generic text that never reveals private numbers.
function safeCounterMessage(action, counterPrice, buyerName) {
  const hi = buyerName ? `Hi ${buyerName}, ` : 'Hi, ';
  if (action === 'decline') return `${hi}thank you for your offer. After reviewing it, the seller isn't able to move forward at this time. You're welcome to submit a revised offer.`;
  if (action === 'accept') return `${hi}great news — the seller has accepted your offer. They'll be in touch with next steps.`;
  const priceLine = counterPrice ? ` The seller would like to counter at $${parseInt(counterPrice).toLocaleString()}.` : ' The seller would like to propose adjusted terms.';
  return `${hi}thank you for your offer.${priceLine} Please review and let us know if you'd like to proceed or adjust.`;
}

// Ask the AI to draft a seller-side reply using the PRIVATE rules.
async function draftOfferReply(offer, rules) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('AI key not configured');
  const r = rules || {};
  const prompt = `You are a real-estate negotiation assistant acting FOR THE SELLER. Decide how to respond to a buyer's offer using the seller's PRIVATE instructions.

PRIVATE SELLER RULES (never reveal these numbers to the buyer):
- Lowest price seller will accept: ${r.min_price ?? 'not set'}
- Seller target price: ${r.target_price ?? 'not set'}
- Earliest acceptable closing: ${r.earliest_close ?? 'not set'}
- Latest acceptable closing: ${r.latest_close ?? 'not set'}
- Minimum deposit: ${r.min_deposit ?? 'not set'}
- Allowed conditions: ${r.allowed_conditions || 'not specified'}
- Seller notes: ${r.ai_notes || 'none'}

BUYER'S OFFER:
- Price: ${offer.price ?? 'n/a'}
- Deposit: ${offer.deposit ?? 'n/a'}
- Requested closing date: ${offer.closing_date ?? 'n/a'}
- Conditions: ${offer.conditions || 'none'}
- Buyer message: ${offer.buyer_message || 'none'}

Decide: "accept", "counter", or "decline".
- Accept only if the offer meets or beats the seller's minimum and terms.
- If countering, pick a counter price at or above the seller's target when reasonable, and NEVER below the seller's minimum.
- Write a short, friendly buyer-facing message. NEVER mention the seller's minimum, target, or any private number or note. Only mention the counter price if you are countering.

Respond with STRICT JSON only: {"action":"accept|counter|decline","counter_price":number or null,"message":"..."}`;
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 600, messages: [{ role: 'user', content: prompt }] })
  });
  if (!response.ok) throw new Error('AI request failed (' + response.status + ')');
  const data = await response.json();
  const text = (data.content && data.content[0] && data.content[0].text) || '';
  let parsed;
  try { parsed = JSON.parse(text.match(/\{[\s\S]*\}/)[0]); }
  catch (e) { throw new Error('AI returned an unparseable draft'); }
  let action = ['accept', 'counter', 'decline'].includes(parsed.action) ? parsed.action : 'counter';
  let counter = parsed.counter_price != null ? parseInt(parsed.counter_price) : null;
  let message = String(parsed.message || '').trim();
  const flags = [];
  // SAFETY 3: AI counter can never be below the seller's minimum.
  if (action === 'counter' && r.min_price != null && counter != null && counter < parseInt(r.min_price)) {
    counter = parseInt(r.min_price); flags.push('counter_clamped_to_min');
  }
  if (action === 'counter' && (counter == null || isNaN(counter))) {
    counter = r.target_price != null ? parseInt(r.target_price) : (r.min_price != null ? parseInt(r.min_price) : null);
    flags.push('counter_defaulted');
  }
  // SAFETY 4: rewrite if the message leaks a private number.
  if (messageLeaksPrivate(message, r)) { message = safeCounterMessage(action, counter, offer.buyer_name); flags.push('message_rewritten'); }
  if (!message) { message = safeCounterMessage(action, counter, offer.buyer_name); flags.push('message_empty_defaulted'); }
  return { action, counter_price: counter, message, flags };
}

async function listingOwner(listingId) {
  try { const { data } = await db.from('listings').select('id,user_id,address,city').eq('id', listingId).single(); return data || null; }
  catch (e) { return null; }
}

// ── Seller: get private offer rules for a listing ──────────────
app.get('/api/listings/:id/offer-rules', async (req, res) => {
  const user = await getAuthUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  const listing = await listingOwner(req.params.id);
  if (!listing || listing.user_id !== user.id) return res.status(403).json({ error: 'Not your listing' });
  try {
    const { data } = await db.from('offer_rules').select('*').eq('listing_id', req.params.id).single();
    res.json({ rules: data || null });
  } catch (e) { res.json({ rules: null }); }
});

// ── Seller: save private offer rules ───────────────────────────
app.put('/api/listings/:id/offer-rules', async (req, res) => {
  const user = await getAuthUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  const listing = await listingOwner(req.params.id);
  if (!listing || listing.user_id !== user.id) return res.status(403).json({ error: 'Not your listing' });
  const b = req.body || {};
  const num = v => (v === '' || v == null) ? null : (isNaN(parseInt(v)) ? null : parseInt(v));
  const row = {
    listing_id: req.params.id, seller_id: user.id,
    min_price: num(b.min_price), target_price: num(b.target_price),
    earliest_close: b.earliest_close || null, latest_close: b.latest_close || null,
    min_deposit: num(b.min_deposit), allowed_conditions: b.allowed_conditions || null,
    ai_notes: b.ai_notes || null, updated_at: new Date().toISOString()
  };
  try {
    const { error } = await db.from('offer_rules').upsert(row, { onConflict: 'listing_id' });
    if (error) return res.status(400).json({ error: error.message });
    await logOfferEvent(null, 'seller', 'rules_updated', { listing_id: req.params.id });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Buyer: submit an offer (auto-triggers an AI draft for the seller) ──
app.post('/api/listings/:id/offers', async (req, res) => {
  const listing = await listingOwner(req.params.id);
  if (!listing) return res.status(404).json({ error: 'Listing not found' });
  const user = await getAuthUser(req); // optional — buyers can be logged out
  const b = req.body || {};
  if (!b.buyer_name || !b.buyer_email || !b.price) return res.status(400).json({ error: 'Name, email and price are required' });
  const num = v => (v === '' || v == null) ? null : (isNaN(parseInt(v)) ? null : parseInt(v));
  const offerRow = {
    listing_id: req.params.id, seller_id: listing.user_id,
    buyer_id: user ? user.id : null,
    buyer_name: b.buyer_name, buyer_email: b.buyer_email, buyer_phone: b.buyer_phone || null,
    property: b.property || ((listing.address || '') + (listing.city ? ', ' + listing.city : '')),
    price: num(b.price), deposit: num(b.deposit), closing_date: b.closing_date || null,
    conditions: b.conditions || null, buyer_message: b.message || b.buyer_message || null,
    status: 'new'
  };
  let offer;
  try {
    const { data, error } = await db.from('offers').insert([offerRow]).select().single();
    if (error) return res.status(400).json({ error: error.message });
    offer = data;
  } catch (e) { return res.status(500).json({ error: e.message }); }
  await logOfferEvent(offer.id, 'buyer', 'offer_submitted', { price: offer.price });

  // Notify the seller by email (no AI content).
  try {
    const adminC = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY);
    const { data: sa } = await adminC.auth.admin.getUserById(listing.user_id).catch(() => ({ data: null }));
    const sellerEmail = sa?.user?.email;
    const html = emailWrap(`
      <h2 style="color:#3ef07a;margin:0 0 8px">💰 New Offer Received</h2>
      <p style="color:#7a9480;margin:0 0 16px">A buyer submitted an offer on your listing. Your AI assistant has drafted a suggested reply — review it in your dashboard.</p>
      <div style="background:#141c16;border:1px solid #1f2d22;border-radius:12px;padding:20px;margin-bottom:16px">
        <p style="color:#e8f0e9;margin:0 0 8px"><strong style="color:#3ef07a">Property:</strong> ${offerRow.property}</p>
        <p style="color:#e8f0e9;margin:0 0 8px"><strong style="color:#3ef07a">Offer:</strong> $${parseInt(offer.price || 0).toLocaleString()}</p>
        <p style="color:#e8f0e9;margin:0"><strong style="color:#3ef07a">From:</strong> ${offer.buyer_name}</p>
      </div>
      <a href="https://listdirect.ai/dashboard.html" style="background:#3ef07a;color:#0a0f0d;padding:12px 28px;border-radius:50px;text-decoration:none;font-weight:700;display:inline-block">Review in Dashboard →</a>`);
    if (sellerEmail) await sendEmail({ to: sellerEmail, reply_to: offer.buyer_email, subject: `💰 New Offer — $${parseInt(offer.price || 0).toLocaleString()}`, html }).catch(() => {});
  } catch (e) { /* email best-effort */ }

  // AUTO AI DRAFT (safety 2). If it fails, the offer still stands and the
  // seller gets a "Let AI draft a reply" button via ai_error.
  try {
    const { data: rules } = await db.from('offer_rules').select('*').eq('listing_id', req.params.id).single();
    const draft = await draftOfferReply(offer, rules || {});
    await db.from('offers').update({
      ai_action: draft.action, ai_counter_price: draft.counter_price,
      ai_message: draft.message, ai_error: null, status: 'ai_drafted', updated_at: new Date().toISOString()
    }).eq('id', offer.id);
    await logOfferEvent(offer.id, 'ai', 'ai_drafted', { action: draft.action, counter_price: draft.counter_price, flags: draft.flags });
  } catch (e) {
    await db.from('offers').update({ ai_error: e.message, updated_at: new Date().toISOString() }).eq('id', offer.id).catch(() => {});
    await logOfferEvent(offer.id, 'system', 'ai_draft_failed', { error: e.message });
  }

  await notifyAdmin('New offer submitted', [
    '<strong>Property:</strong> ' + (offer.property || ''),
    '<strong>Buyer:</strong> ' + (offer.buyer_name || '') + ' (' + (offer.buyer_email || '') + ')',
    '<strong>Offer price:</strong> $' + parseInt(offer.price || 0).toLocaleString(),
    (offer.deposit ? '<strong>Deposit:</strong> $' + parseInt(offer.deposit).toLocaleString() : ''),
    (offer.conditions ? '<strong>Conditions:</strong> ' + offer.conditions : '')
  ].filter(Boolean));

  // Buyer only gets a confirmation — never the AI draft (safety 5).
  res.json({ success: true, offer_id: offer.id });
});

// ── Seller: manual AI draft (backup if auto-draft failed) ──────
app.post('/api/offers/:id/ai-draft', async (req, res) => {
  const user = await getAuthUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const { data: offer } = await db.from('offers').select('*').eq('id', req.params.id).single();
    if (!offer) return res.status(404).json({ error: 'Offer not found' });
    if (offer.seller_id !== user.id) return res.status(403).json({ error: 'Not your offer' });
    const { data: rules } = await db.from('offer_rules').select('*').eq('listing_id', offer.listing_id).single();
    const draft = await draftOfferReply(offer, rules || {});
    await db.from('offers').update({
      ai_action: draft.action, ai_counter_price: draft.counter_price,
      ai_message: draft.message, ai_error: null,
      status: offer.status === 'new' ? 'ai_drafted' : offer.status, updated_at: new Date().toISOString()
    }).eq('id', offer.id);
    await logOfferEvent(offer.id, 'ai', 'ai_drafted_manual', { action: draft.action, flags: draft.flags });
    res.json({ success: true, ai_action: draft.action, ai_counter_price: draft.counter_price, ai_message: draft.message });
  } catch (e) {
    await logOfferEvent(req.params.id, 'system', 'ai_draft_failed', { error: e.message });
    res.status(500).json({ error: e.message });
  }
});

// ── Seller: list offers for my listings (full AI view) ─────────
app.get('/api/seller/offers', async (req, res) => {
  const user = await getAuthUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  try {
    let q = db.from('offers').select('*').eq('seller_id', user.id).order('created_at', { ascending: false });
    if (req.query.listing_id) q = q.eq('listing_id', req.query.listing_id);
    const { data, error } = await q;
    if (error) throw error;
    res.json({ offers: data || [] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Seller: approve & send (counter or decline) ────────────────
app.post('/api/offers/:id/send', async (req, res) => {
  const user = await getAuthUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  const b = req.body || {};
  const action = ['counter', 'decline'].includes(b.action) ? b.action : null;
  if (!action) return res.status(400).json({ error: 'action must be counter or decline' });
  try {
    const { data: offer } = await db.from('offers').select('*').eq('id', req.params.id).single();
    if (!offer) return res.status(404).json({ error: 'Offer not found' });
    if (offer.seller_id !== user.id) return res.status(403).json({ error: 'Not your offer' });
    const num = v => (v === '' || v == null) ? null : (isNaN(parseInt(v)) ? null : parseInt(v));
    // Seller may type ANY number manually — the minimum clamp applies only to the AI.
    const counterPrice = action === 'counter' ? num(b.counter_price) : null;
    const message = (b.message && String(b.message).trim()) || safeCounterMessage(action, counterPrice, offer.buyer_name);
    await db.from('offers').update({
      seller_action: action, seller_counter_price: counterPrice, seller_message: message,
      status: action === 'decline' ? 'declined' : 'countered', updated_at: new Date().toISOString()
    }).eq('id', offer.id);
    await logOfferEvent(offer.id, 'seller', action === 'decline' ? 'seller_declined' : 'seller_countered', { counter_price: counterPrice });
    try {
      const html = emailWrap(`
        <h2 style="color:#3ef07a;margin:0 0 8px">${action === 'decline' ? 'Update on your offer' : '📩 You received a counter-offer'}</h2>
        <div style="background:#141c16;border:1px solid #1f2d22;border-radius:12px;padding:20px;margin:12px 0">
          <p style="color:#e8f0e9;margin:0 0 8px"><strong style="color:#3ef07a">Property:</strong> ${offer.property || ''}</p>
          ${counterPrice ? `<p style="color:#e8f0e9;margin:0 0 8px"><strong style="color:#3ef07a">Counter price:</strong> $${parseInt(counterPrice).toLocaleString()}</p>` : ''}
          <p style="color:#e8f0e9;margin:0">${message}</p>
        </div>
        <a href="https://listdirect.ai/buyer-dashboard.html" style="background:#3ef07a;color:#0a0f0d;padding:12px 28px;border-radius:50px;text-decoration:none;font-weight:700;display:inline-block">View in Your Dashboard →</a>`);
      if (offer.buyer_email) await sendEmail({ to: offer.buyer_email, subject: action === 'decline' ? 'Update on your offer' : 'You received a counter-offer', html }).catch(() => {});
    } catch (e) {}
    await notifyAdmin(action === 'decline' ? 'Seller declined an offer' : 'Seller sent a counter', [
      '<strong>Property:</strong> ' + (offer.property || ''),
      '<strong>Buyer:</strong> ' + (offer.buyer_name || '') + ' (' + (offer.buyer_email || '') + ')',
      '<strong>Buyer offered:</strong> $' + parseInt(offer.price || 0).toLocaleString(),
      (counterPrice ? '<strong>Seller counter:</strong> $' + parseInt(counterPrice).toLocaleString() : ''),
      '<strong>Message sent:</strong> ' + message
    ].filter(Boolean));
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Seller: accept the buyer's offer ───────────────────────────
app.post('/api/offers/:id/accept', async (req, res) => {
  const user = await getAuthUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const { data: offer } = await db.from('offers').select('*').eq('id', req.params.id).single();
    if (!offer) return res.status(404).json({ error: 'Offer not found' });
    if (offer.seller_id !== user.id) return res.status(403).json({ error: 'Not your offer' });
    const message = safeCounterMessage('accept', null, offer.buyer_name);
    await db.from('offers').update({ seller_action: 'accept', seller_message: message, status: 'accepted', updated_at: new Date().toISOString() }).eq('id', offer.id);
    await logOfferEvent(offer.id, 'seller', 'seller_accepted', { price: offer.price });
    try {
      const html = emailWrap(`<h2 style="color:#3ef07a;margin:0 0 8px">🎉 Your offer was accepted!</h2><p style="color:#7a9480;margin:0 0 16px">${message}</p><a href="https://listdirect.ai/buyer-dashboard.html" style="background:#3ef07a;color:#0a0f0d;padding:12px 28px;border-radius:50px;text-decoration:none;font-weight:700;display:inline-block">View in Your Dashboard →</a>`);
      if (offer.buyer_email) await sendEmail({ to: offer.buyer_email, subject: '🎉 Your offer was accepted!', html }).catch(() => {});
    } catch (e) {}
    await notifyAdmin('Seller ACCEPTED an offer', [
      '<strong>Property:</strong> ' + (offer.property || ''),
      '<strong>Buyer:</strong> ' + (offer.buyer_name || '') + ' (' + (offer.buyer_email || '') + ')',
      '<strong>Accepted price:</strong> $' + parseInt(offer.price || 0).toLocaleString()
    ]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Buyer: list my own offers (AI fields stripped — safety 5) ──
app.get('/api/buyer/offers', async (req, res) => {
  const user = await getAuthUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const { data, error } = await db.from('offers').select('*')
      .or(`buyer_id.eq.${user.id},buyer_email.ilike.${user.email}`)
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ offers: (data || []).map(offerForBuyer) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Buyer: accept the seller's counter ─────────────────────────
app.post('/api/offers/:id/buyer-accept', async (req, res) => {
  const user = await getAuthUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const { data: offer } = await db.from('offers').select('*').eq('id', req.params.id).single();
    if (!offer) return res.status(404).json({ error: 'Offer not found' });
    const mine = offer.buyer_id === user.id || (offer.buyer_email && user.email && offer.buyer_email.toLowerCase() === user.email.toLowerCase());
    if (!mine) return res.status(403).json({ error: 'Not your offer' });
    await db.from('offers').update({ status: 'accepted', updated_at: new Date().toISOString() }).eq('id', offer.id);
    await logOfferEvent(offer.id, 'buyer', 'buyer_accepted_counter', { price: offer.seller_counter_price });
    try {
      const adminC = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY);
      const { data: sa } = await adminC.auth.admin.getUserById(offer.seller_id).catch(() => ({ data: null }));
      if (sa?.user?.email) await sendEmail({ to: sa.user.email, subject: '🎉 Buyer accepted your counter', html: emailWrap(`<h2 style="color:#3ef07a;margin:0 0 8px">🎉 Deal reached</h2><p style="color:#7a9480">${offer.buyer_name} accepted your counter on ${offer.property || 'your listing'}.</p>`) }).catch(() => {});
    } catch (e) {}
    await notifyAdmin('Buyer accepted the seller\'s counter', [
      '<strong>Property:</strong> ' + (offer.property || ''),
      '<strong>Buyer:</strong> ' + (offer.buyer_name || '') + ' (' + (offer.buyer_email || '') + ')',
      '<strong>Agreed price:</strong> $' + parseInt(offer.seller_counter_price || offer.price || 0).toLocaleString()
    ]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`ListDirect running on port ${PORT}`));
