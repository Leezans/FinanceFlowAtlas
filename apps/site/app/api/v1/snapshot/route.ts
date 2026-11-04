export const dynamic='force-dynamic';
export async function GET(){return Response.json({detail:'IMF holdings are not connected to this hosted proof. No substitute holdings are generated.'},{status:503,headers:{'Cache-Control':'no-store'}})}
