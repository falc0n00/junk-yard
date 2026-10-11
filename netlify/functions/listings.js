import { supabaseAdmin } from './_supabase.js';

export default async (req) => {
  const url = new URL(req.url);

  // ---------- GET /api/listings ----------
  // Public browse endpoint. Filters: brand, model, year, category, part_type, condition, keyword
  if (req.method === 'GET') {
    const params = Object.fromEntries(url.searchParams);

    let query = supabaseAdmin
      .from('listings')
      .select('id, brand, model, year_from, year_to, category, part_type, condition, price, title, description, photos, status, created_at, seller_id, sellers!inner(name, phone, suspended)')
      .eq('status', 'active')
      .eq('sellers.suspended', false);

    if (params.brand)      query = query.eq('brand', params.brand);
    if (params.model)      query = query.eq('model', params.model);
    if (params.category)   query = query.eq('category', params.category);
    if (params.part_type)  query = query.eq('part_type', params.part_type);
    if (params.condition)  query = query.eq('condition', params.condition);
    if (params.year)       query = query.lte('year_from', params.year).gte('year_to', params.year);

    if (params.keyword) {
      const kw = `%${params.keyword}%`;
      query = query.or(`title.ilike.${kw},description.ilike.${kw},brand.ilike.${kw},model.ilike.${kw},part_type.ilike.${kw}`);
    }

    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) return json({ error: error.message }, 500);
    return json(data);
  }

  // ---------- POST /api/listings ----------
  // Create a new listing. Requires a logged-in seller (Bearer token).
  if (req.method === 'POST') {
    const authHeader = req.headers.get('authorization') || req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing auth token' }, 401);

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) return json({ error: 'Invalid token' }, 401);

    // Find the seller profile
    const { data: seller, error: sellerErr } = await supabaseAdmin
      .from('sellers')
      .select('id, suspended, name')
      .eq('user_id', user.id)
      .maybeSingle();

    if (sellerErr) return json({ error: sellerErr.message }, 500);
    if (!seller)   return json({ error: 'Seller profile not found. Complete signup first.' }, 404);
    if (seller.suspended) return json({ error: 'Account suspended' }, 403);

    const body = await req.json();

    // Minimal validation
    const required = ['brand', 'model', 'year_from', 'year_to', 'category', 'part_type', 'condition', 'price', 'title'];
    for (const f of required) {
      if (body[f] === undefined || body[f] === null || body[f] === '') {
        return json({ error: `Missing field: ${f}` }, 400);
      }
    }

    const { data, error } = await supabaseAdmin
      .from('listings')
      .insert({
        seller_id: seller.id,
        brand: body.brand,
        model: body.model,
        year_from: Number(body.year_from),
        year_to: Number(body.year_to),
        category: body.category,
        part_type: body.part_type,
        condition: body.condition,
        price: Number(body.price),
        title: body.title,
        description: body.description || '',
        photos: Array.isArray(body.photos) ? body.photos : [],
        status: 'active',
      })
      .select()
      .single();

    if (error) return json({ error: error.message }, 500);
    return json(data, 201);
  }

  return json({ error: 'Method not allowed' }, 405);
};

// Helper
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Map this function to /api/listings
export const config = { path: '/api/listings' };
