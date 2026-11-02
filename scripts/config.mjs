// config.js is generated, never committed: its settings come from environment variables.
//   GOOGLE_CLIENT_ID  the OAuth client ID; without it the start page asks for one.

export function configScript(env = process.env) {
  const config = { clientId: env.GOOGLE_CLIENT_ID?.trim() ?? '' };
  return `// Generated from environment variables by scripts/config.mjs.\nwindow.DRIVE_TREEMAP = ${JSON.stringify(config, null, 2)};\n`;
}
