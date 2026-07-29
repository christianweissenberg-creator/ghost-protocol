"""Ghost Protocol — Posting Guard (harter Riegel fuer externes Publizieren).

Anfangsphase-Regel (Betreiber-Entscheid, verankert 29.07.2026):
Die Content-Pipeline endet VOR dem Posting. Jede Veroeffentlichung
(X/Twitter, MailerLite-Newsletter, weitere Kanaele) erfolgt MANUELL durch
den Betreiber nach ausdruecklicher Freigabe.

Dieser Riegel ist fail-closed: Externes Posten ist nur moeglich, wenn der
Betreiber es BEWUSST per Env freischaltet:

    GP_EXTERNAL_POSTING=enabled

Alles andere (fehlend, leer, "true", "1", Tippfehler) bleibt gesperrt.
"""

import logging
import os

logger: logging.Logger = logging.getLogger(__name__)


class PostingDisabledError(RuntimeError):
    """Externes Posting ist deaktiviert (Anfangsphase: manuelle Freigabe)."""


def external_posting_enabled() -> bool:
    """True nur bei bewusster Freischaltung durch den Betreiber."""
    return os.environ.get("GP_EXTERNAL_POSTING", "").strip().lower() == "enabled"


def require_external_posting(action: str) -> None:
    """Wirft PostingDisabledError, solange externes Posting gesperrt ist."""
    if external_posting_enabled():
        logger.warning(
            "Externes Posting FREIGESCHALTET (GP_EXTERNAL_POSTING=enabled) — %s",
            action,
        )
        return
    raise PostingDisabledError(
        f"BLOCKIERT: {action} — externes Posting ist hart deaktiviert. "
        "Die Pipeline endet vor dem Posting; der Betreiber veroeffentlicht "
        "manuell nach Freigabe. Bewusste Freischaltung nur via "
        "GP_EXTERNAL_POSTING=enabled."
    )
