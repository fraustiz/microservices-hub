export function healthResponse(service: string): Response {
  return Response.json({ status: "ok", service, time: new Date().toISOString() });
}
