export type NativeSharePayload = {
  title: string;
  text?: string;
  url: string;
};

export async function tryNativeShare(payload: NativeSharePayload): Promise<boolean> {
  try {
    const nav = navigator as Navigator & {
      share?: (data: { title?: string; text?: string; url?: string }) => Promise<void>;
      canShare?: (data: { title?: string; text?: string; url?: string }) => boolean;
    };

    if (typeof nav === "undefined" || typeof nav.share !== "function") return false;

    const data = {
      title: payload.title,
      text: payload.text,
      url: payload.url,
    };

    if (typeof nav.canShare === "function" && !nav.canShare(data)) return false;

    await nav.share(data);
    return true;
  } catch {
    return false;
  }
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // ignore
  }

  try {
    const el = document.createElement("textarea");
    el.value = text;
    el.style.position = "fixed";
    el.style.left = "-9999px";
    el.style.top = "0";
    document.body.appendChild(el);
    el.focus();
    el.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(el);
    return ok;
  } catch {
    return false;
  }
}
