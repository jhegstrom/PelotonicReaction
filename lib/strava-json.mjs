// Preserve integer tokens before JSON.parse can round them. Match complete JSON
// strings first so digits and escaped quotes inside names/messages stay untouched.
export function parseStravaJson(text) {
  return JSON.parse(text.replace(/"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g, token => {
    if (/^-?\d+$/.test(token) && !Number.isSafeInteger(Number(token))) return JSON.stringify(token);
    return token;
  }));
}
