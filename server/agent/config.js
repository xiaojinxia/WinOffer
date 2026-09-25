export function agentConfig(env = process.env) {
  return { key:env.DEEPSEEK_API_KEY||'', model:env.DEEPSEEK_MODEL||'deepseek-flash', account:env.QQ_EMAIL||'', password:env.QQ_AUTH_CODE||'', demo:env.WINOFFER_AGENT_DEMO==='true' };
}
