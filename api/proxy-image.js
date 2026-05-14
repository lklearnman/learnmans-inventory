// Vercel API: 图片代理，绕过CORS
export default async function handler(req, res){
  const {url} = req.query;
  if(!url) return res.status(400).json({error:'missing url'});
  
  try{
    const r = await fetch(url);
    if(!r.ok) return res.status(r.status).json({error:'fetch failed: '+r.status});
    
    const buf = await r.arrayBuffer();
    const b64 = Buffer.from(buf).toString('base64');
    const ct = r.headers.get('content-type')||'image/jpeg';
    
    res.setHeader('Access-Control-Allow-Origin','*');
    res.setHeader('Cache-Control','public, max-age=3600');
    res.status(200).json({
      data: `data:${ct};base64,${b64}`,
      size: buf.byteLength
    });
  }catch(e){
    res.status(500).json({error: e.message});
  }
}
