export function GET(_req, { params }) {
  const code = Number(params.code);
  const status = Number.isInteger(code) && code >= 100 && code <= 599 ? code : 400;

  return new Response(
    JSON.stringify({
      status,
      message: status === 418 ? 'short and stout' : `responded with ${status}`
    }),
    { status, headers: { 'content-type': 'application/json' } }
  );
}
