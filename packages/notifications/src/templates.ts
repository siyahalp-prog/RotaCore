/**
 * Minimal mustache-style template renderer: replaces `{{variable}}` placeholders.
 * Unknown variables render as an empty string so templates never leak raw placeholders.
 */
export function renderTemplate(template: string, variables: Record<string, string> = {}): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_match, key: string) => {
    return variables[key] ?? '';
  });
}
