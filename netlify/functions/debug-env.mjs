// debug-env.mjs — minimal function to verify the function runtime is alive
// and the service role key is reaching function scope.

export const handler = async (event) => {
  console.log('=== debug-env invoked ===')
  console.log('method:', event.httpMethod)
  console.log('has ANTHROPIC_API_KEY:', !!process.env.ANTHROPIC_API_KEY)
  console.log('has SUPABASE_SERVICE_ROLE_KEY:', !!process.env.SUPABASE_SERVICE_ROLE_KEY)
  console.log('has SUPABASE_URL:', !!process.env.SUPABASE_URL)
  console.log('has VITE_SUPABASE_URL:', !!process.env.VITE_SUPABASE_URL)
  console.log('has VITE_SUPABASE_ANON_KEY:', !!process.env.VITE_SUPABASE_ANON_KEY)

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      alive: true,
      env: {
        ANTHROPIC_API_KEY: !!process.env.ANTHROPIC_API_KEY,
        SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
        SUPABASE_URL: !!process.env.SUPABASE_URL,
        VITE_SUPABASE_URL: !!process.env.VITE_SUPABASE_URL,
        VITE_SUPABASE_ANON_KEY: !!process.env.VITE_SUPABASE_ANON_KEY,
      },
    }),
  }
}
