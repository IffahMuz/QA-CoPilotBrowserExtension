export interface FilteredCookie {
  name: string;
  domain: string;
  httpOnly: boolean;
  secure: boolean;
  session: boolean;
}

export class CookieProbe {
  static async filtered(url: string): Promise<{ cookies: FilteredCookie[]; removedNames: string[] }> {
    const all = await chrome.cookies.getAll({ url });
    const cookies = all
      .filter((c) => !c.httpOnly && !c.secure)
      .map((c) => ({
        name: c.name,
        domain: c.domain,
        httpOnly: c.httpOnly,
        secure: c.secure,
        session: c.session,
      }));
    const removedNames = all
      .filter((c) => c.httpOnly || c.secure)
      .map((c) => c.name);
    return { cookies, removedNames };
  }
}
