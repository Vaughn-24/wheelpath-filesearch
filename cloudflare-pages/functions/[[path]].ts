// Proxy all requests to Cloud Run
const CLOUD_RUN_URL = 'https://wheelpath-web-l2phyyl55q-uc.a.run.app';

export async function onRequest(context: { request: Request; params: { path: string[] } }) {
  const url = new URL(context.request.url);
  const targetUrl = new URL(url.pathname + url.search, CLOUD_RUN_URL);
  
  // Create headers without host
  const headers = new Headers(context.request.headers);
  headers.delete('host');
  
  const response = await fetch(targetUrl.toString(), {
    method: context.request.method,
    headers: headers,
    body: context.request.method !== 'GET' && context.request.method !== 'HEAD' 
      ? context.request.body 
      : undefined,
    redirect: 'manual',
  });

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
