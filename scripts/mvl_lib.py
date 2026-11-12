"""Helpers shared by the MVL-supplement scripts. Reads no MLV.xls (safe to publish)."""
import re
import unicodedata

def clean(v):
    return re.sub(r"\s+", " ", str(v).replace(" ", " ")).strip()


HYB_STOP = {"greenhouse", "greenhouses", "gardens", "garden", "violets", "violet", "african", "the", "and", "inc", "nursery",
            "nurseries", "farm", "farms", "mrs", "mr", "dr", "miss", "ms", "jr", "sr", "co", "company"}


def hyb_tokens(h):
    h = unicodedata.normalize("NFKD", clean(h)).encode("ascii", "ignore").decode().lower()
    h = re.sub(r"['`]s\b|s'(?=\s|$)", "", h)
    toks = set()
    for w in re.findall(r"[a-z]+", h):
        if len(w) > 1 and w not in HYB_STOP:
            toks.add(w[:-1] if len(w) >= 5 and w.endswith("s") and not w.endswith("ss") else w)
    return toks


