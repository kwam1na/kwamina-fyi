from __future__ import annotations

import hashlib
import re
import unittest
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit


CONTENT_ROOT = Path(__file__).resolve().parents[1]
PUBLIC_ROOT = CONTENT_ROOT.parents[1] / "public"
PAGES = {
    "homepage": CONTENT_ROOT / "homepage-draft-v1.html",
    "athena": CONTENT_ROOT / "work" / "athena" / "index.html",
    "local_first_pos": CONTENT_ROOT
    / "work"
    / "athena"
    / "local-first-pos"
    / "index.html",
    "agent_ready_repository": CONTENT_ROOT
    / "work"
    / "athena"
    / "agent-ready-repository"
    / "index.html",
}
UNSAFE_ATHENA_ASSETS = {
    "athena-daily-operations.png",
    "athena-point-of-sale.png",
    "athena-procurement.png",
}
MEDIA_SUFFIXES = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".mp4", ".webm", ".mov", ".pdf"}


class PageParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.ids: list[str] = []
        self.headings: list[int] = []
        self.hrefs: list[str] = []
        self.media_refs: list[str] = []
        self.main_count = 0
        self.skip_targets: list[str] = []
        self.claim_ids: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = dict(attrs)
        element_id = attributes.get("id")
        if element_id:
            self.ids.append(element_id)
        claim_id = attributes.get("data-claim")
        if claim_id:
            self.claim_ids.append(claim_id)
        if re.fullmatch(r"h[1-6]", tag):
            self.headings.append(int(tag[1]))
        if tag == "main":
            self.main_count += 1
        href = attributes.get("href")
        if href:
            self.hrefs.append(href)
            if Path(unquote(urlsplit(href).path)).suffix.lower() in MEDIA_SUFFIXES:
                self.media_refs.append(href)
            classes = set((attributes.get("class") or "").split())
            if "skip-link" in classes:
                self.skip_targets.append(href)
        for attribute in ("src", "poster", "data"):
            reference = attributes.get(attribute)
            if reference:
                self.media_refs.append(reference)
        srcset = attributes.get("srcset")
        if srcset:
            self.media_refs.extend(candidate.strip().split()[0] for candidate in srcset.split(",") if candidate.strip())


def parse_page(path: Path) -> PageParser:
    parser = PageParser()
    parser.feed(path.read_text(encoding="utf-8"))
    return parser


def is_external(reference: str) -> bool:
    return urlsplit(reference).scheme in {"http", "https", "mailto", "tel", "data"}


def resolve_site_reference(source: Path, reference: str) -> Path | None:
    # The site serves from two roots: the authored pages under docs/content and
    # the static files under public/, which are copied to the deployed root. An
    # absolute reference can therefore live in either. Extensionless references
    # are router paths (href="about" -> /about), whose authored file carries the
    # .html suffix.
    if is_external(reference) or reference.startswith("//"):
        return None
    path_text = unquote(urlsplit(reference).path)
    if not path_text:
        return source
    if path_text.startswith("/"):
        bases = [CONTENT_ROOT / path_text.lstrip("/"), PUBLIC_ROOT / path_text.lstrip("/")]
    else:
        bases = [source.parent / path_text]

    candidates: list[Path] = []
    for base in bases:
        if path_text.endswith("/") or base.is_dir():
            base = base / "index.html"
        candidates.append(base)
        if not base.suffix:
            candidates.append(base.with_suffix(".html"))

    for candidate in candidates:
        if candidate.exists():
            return candidate.resolve()
    return candidates[0].resolve()


def evidence_rows() -> dict[str, dict[str, str]]:
    ledger = CONTENT_ROOT / "work" / "athena" / "evidence.md"
    if not ledger.exists():
        return {}
    rows: dict[str, dict[str, str]] = {}
    for line in ledger.read_text(encoding="utf-8").splitlines():
        if not line.startswith("| media "):
            continue
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        if len(cells) < 12:
            continue
        _, public_path, source_revision, digest, provenance, pii, amounts, metadata, strings, reviewer, review_date, decision = cells[:12]
        rows[public_path] = {
            "source_revision": source_revision,
            "hash": digest,
            "provenance": provenance,
            "pii": pii,
            "amounts": amounts,
            "metadata": metadata,
            "strings": strings,
            "reviewer": reviewer,
            "review_date": review_date,
            "decision": decision,
        }
    return rows


def claim_rows() -> dict[str, dict[str, str]]:
    ledger = CONTENT_ROOT / "work" / "athena" / "evidence.md"
    if not ledger.exists():
        return {}
    rows: dict[str, dict[str, str]] = {}
    for line in ledger.read_text(encoding="utf-8").splitlines():
        if not line.startswith("| claim-"):
            continue
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        if len(cells) < 6:
            continue
        claim_id, section, wording, source, limitation, review_state = cells[:6]
        if claim_id in rows:
            raise AssertionError(f"Duplicate evidence claim: {claim_id}")
        rows[claim_id] = {
            "section": section,
            "wording": wording,
            "source": source,
            "limitation": limitation,
            "review_state": review_state,
        }
    return rows


def structured_text(figure: str, description_id: str) -> str:
    element = re.search(
        rf'<(div|ol|ul|p)\b[^>]*id="{re.escape(description_id)}"[^>]*>([\s\S]*?)</\1>',
        figure,
    )
    if element is None:
        return ""
    return " ".join(re.sub(r"<[^>]+>", " ", element.group(2)).split()).lower()


def nav_fragment_targets(html: str, label: str) -> set[str]:
    nav = re.search(rf'<nav\b[^>]*aria-label="{re.escape(label)}"[^>]*>([\s\S]*?)</nav>', html)
    if nav is None:
        return set()
    return {urlsplit(href).fragment for href in re.findall(r'href="([^"]+)"', nav.group(1)) if urlsplit(href).fragment}


class StaticPageTests(unittest.TestCase):
    def assert_accessible_figures(
        self,
        path: Path,
        minimum: int,
        expected_sequences: dict[str, tuple[str, ...]] | None = None,
    ) -> None:
        html = path.read_text(encoding="utf-8")
        figure_blocks = re.findall(r"<figure\b[\s\S]*?</figure>", html)
        self.assertGreaterEqual(len(figure_blocks), minimum)
        for figure in figure_blocks:
            with self.subTest(page=path.name, figure=figure[:80]):
                described_by = re.search(r'aria-describedby="([^"]+)"', figure)
                self.assertIsNotNone(described_by)
                self.assertRegex(figure, r"<figcaption\b")
                description_id = described_by.group(1)
                self.assertRegex(
                    figure,
                    rf'<(?:div|ol|ul|p)\b[^>]*id="{re.escape(description_id)}"[^>]*class="[^"]*structured-equivalent',
                )
                text = structured_text(figure, description_id)
                self.assertTrue(text, f"Empty structured description: {description_id}")
                terms = (expected_sequences or {}).get(description_id, ())
                positions = [text.index(term) for term in terms]
                self.assertEqual(positions, sorted(positions), f"Description order drifted: {description_id}")

    def assert_claims_mapped(self, parser: PageParser, minimum: int) -> None:
        self.assertGreaterEqual(len(parser.claim_ids), minimum)
        self.assertEqual(len(parser.claim_ids), len(set(parser.claim_ids)))
        rows = claim_rows()
        self.assertTrue(set(parser.claim_ids).issubset(rows))
        for claim_id in parser.claim_ids:
            row = rows[claim_id]
            self.assertTrue(all(row.values()), f"Incomplete evidence row: {claim_id}")
            self.assertRegex(row["review_state"], r"^verified \d{4}-\d{2}-\d{2}$")

    def test_expected_page_family_exists(self) -> None:
        for name, path in PAGES.items():
            with self.subTest(page=name):
                self.assertTrue(path.is_file(), f"Missing page: {path.relative_to(CONTENT_ROOT)}")

    def test_page_landmarks_headings_ids_and_skip_links(self) -> None:
        for name, path in PAGES.items():
            with self.subTest(page=name):
                parser = parse_page(path)
                self.assertEqual(parser.main_count, 1)
                self.assertEqual(parser.headings.count(1), 1)
                self.assertEqual(len(parser.ids), len(set(parser.ids)), "IDs must be unique")
                self.assertEqual(parser.skip_targets, ["#main"])
                self.assertIn("main", parser.ids)
                for previous, current in zip(parser.headings, parser.headings[1:]):
                    self.assertLessEqual(current, previous + 1, "Heading levels must not be skipped")

    def test_same_site_links_and_fragments_resolve(self) -> None:
        for name, path in PAGES.items():
            parser = parse_page(path)
            for href in parser.hrefs:
                destination = resolve_site_reference(path, href)
                if destination is None:
                    continue
                with self.subTest(page=name, href=href):
                    self.assertTrue(destination.is_file(), f"Broken same-site link: {href}")
                    fragment = unquote(urlsplit(href).fragment)
                    if fragment:
                        self.assertIn(fragment, parse_page(destination).ids, f"Missing fragment target: {href}")

    def test_homepage_and_deep_page_route_graph(self) -> None:
        homepage = parse_page(PAGES["homepage"])
        self.assertIn("work/athena/", homepage.hrefs)
        expected_home = PAGES["homepage"].resolve()
        expected_athena = PAGES["athena"].resolve()
        for page_name in ("local_first_pos", "agent_ready_repository"):
            resolved = {
                resolve_site_reference(PAGES[page_name], href)
                for href in parse_page(PAGES[page_name]).hrefs
            }
            self.assertIn(expected_home, resolved)
            self.assertIn(expected_athena, resolved)

    def test_athena_main_story_contract(self) -> None:
        html = PAGES["athena"].read_text(encoding="utf-8")
        parser = parse_page(PAGES["athena"])
        expected_sections = {
            "problem",
            "proving-ground",
            "product-model",
            "connected-operations",
            "local-first",
            "agent-ready",
            "current-state",
            "deeper-reading",
        }
        self.assertTrue(expected_sections.issubset(set(parser.ids)))
        self.assertNotIn("contact", parser.ids)
        self.assertIn("Product direction, design, and engineering", html)
        self.assertIn("Built with AI agents", html)
        self.assertIn("Live", html)
        self.assertIn("works", html.lower())
        self.assertIn("being validated", html.lower())
        self.assertIn("not claimed", html.lower())
        self.assertIn("mailto:kwami.nuh@gmail.com", parser.hrefs)
        self.assertEqual(nav_fragment_targets(html, "On this page"), expected_sections)
        context = re.search(r'<aside class="context-rail"[\s\S]*?</aside>', html)
        self.assertIsNotNone(context)
        for value in ("Product direction, design, and engineering", "Built with AI agents", "Live"):
            self.assertIn(value, context.group(0))

    def test_athena_figures_have_visible_structured_equivalents(self) -> None:
        self.assert_accessible_figures(
            PAGES["athena"],
            2,
            {
                "operating-day-description": ("selling", "stock", "procurement", "cash controls", "owner"),
                "store-pulse-description": ("sales", "transactions", "items sold", "history", "products"),
            },
        )

    def test_athena_operating_flow_motion_is_explanatory_and_accessible(self) -> None:
        html = PAGES["athena"].read_text(encoding="utf-8")
        css = (CONTENT_ROOT / "assets" / "athena-story.css").read_text(encoding="utf-8")
        javascript = (CONTENT_ROOT / "assets" / "athena-story.js").read_text(encoding="utf-8")
        page_shell = (CONTENT_ROOT.parents[1] / "src" / "static-page.jsx").read_text(encoding="utf-8")

        self.assertRegex(html, r'<div class="operating-flow" aria-hidden="true">')
        self.assertIn('id="operating-day-description"', html)
        self.assertIn("@keyframes operating-flow-node", css)
        self.assertIn("@keyframes operating-flow-packet", css)
        self.assertIn("@media (prefers-reduced-motion: reduce)", css)
        self.assertIn("IntersectionObserver", javascript)
        self.assertIn("prefers-reduced-motion: reduce", javascript)
        self.assertIn("IntersectionObserver", page_shell)
        self.assertIn("prefers-reduced-motion: reduce", page_shell)

    def test_athena_public_claims_are_mapped_in_evidence_ledger(self) -> None:
        parser = parse_page(PAGES["athena"])
        self.assert_claims_mapped(parser, 8)

    def test_athena_main_story_preserves_claim_boundaries(self) -> None:
        html = PAGES["athena"].read_text(encoding="utf-8").lower()
        self.assertIn("provisioned, locally authorized register", html)
        self.assertIn("not yet a complete cross-domain command center", html)
        for unsupported in (
            "automatically reorders",
            "predicts demand",
            "guarantees correctness",
            "fully autonomous development",
            "agents develop athena autonomously",
        ):
            self.assertNotIn(unsupported, html)

    def test_local_first_pos_reflection_contract(self) -> None:
        path = PAGES["local_first_pos"]
        html = path.read_text(encoding="utf-8")
        lowered = html.lower()
        parser = parse_page(path)
        expected_sections = {
            "online-first",
            "local-evidence",
            "one-path",
            "sync-and-reconciliation",
            "authority-boundary",
            "limits",
            "sources",
        }

        self.assertTrue(expected_sections.issubset(set(parser.ids)))
        self.assertIn("provisioned, locally authorized register", lowered)
        self.assertIn("pos is athena&rsquo;s offline-first workflow", lowered)
        self.assertIn("last-known stock can drift", lowered)
        self.assertIn("accepted cloud projection becomes the cloud source of truth", lowered)
        self.assertNotIn("any browser can sell offline", lowered)

        sequence_terms = (
            "cashier action",
            "append local evidence",
            "cashier success",
            "background synchronization",
            "cloud acceptance or review",
        )
        sequence_html = re.search(r'<figure class="[^"]*sequence-figure[^"]*"[\s\S]*?</figure>', lowered)
        self.assertIsNotNone(sequence_html)
        sequence_positions = [sequence_html.group(0).index(term) for term in sequence_terms]
        self.assertEqual(sequence_positions, sorted(sequence_positions))
        self.assertIn("local authority", lowered)
        self.assertIn("cloud authority", lowered)
        self.assertEqual(nav_fragment_targets(html, "On this page"), expected_sections)

        self.assert_accessible_figures(
            path,
            1,
            {"cashier-cloud-description": ("cashier", "appends", "success", "synchronization", "cloud")},
        )
        self.assert_claims_mapped(parser, 5)

    def test_agent_ready_repository_reflection_contract(self) -> None:
        path = PAGES["agent_ready_repository"]
        html = path.read_text(encoding="utf-8")
        lowered = html.lower()
        parser = parse_page(path)
        expected_sections = {
            "orientation",
            "repository-map",
            "validation",
            "review-loop",
            "delivery-loop",
            "learnings",
            "limits",
            "sources",
        }

        self.assertTrue(expected_sections.issubset(set(parser.ids)))
        for phrase in (
            "generated package maps",
            "fail-closed",
            "representative runtime",
            "substantial athena work moves through",
            "the work narrows while the evidence widens",
            "findings become work",
            "exact current artifact",
            "risk-selected review",
            "every task takes the same path",
            "human reviewer",
            "complete understanding of the codebase",
            "regression-free delivery",
        ):
            self.assertIn(phrase, lowered)
        for internal_detail in (
            "aggregate audit",
            "session logs",
            "user-owned tasks",
            "child-agent sessions",
            "complete local codex archive",
        ):
            self.assertNotIn(internal_detail, lowered)
        self.assertEqual(nav_fragment_targets(html, "On this page"), expected_sections)

        self.assert_accessible_figures(
            path,
            3,
            {
                "repository-map-description": ("registry", "generated", "sensors", "review"),
                "review-loop-description": ("ground", "scope", "workstreams", "integrate", "findings", "release", "live"),
                "delivery-loop-description": ("unit-level", "cross-layer", "repository-level", "independent", "pull-request", "operational"),
            },
        )
        self.assert_claims_mapped(parser, 7)

    def test_claim_ledger_has_no_stale_entries(self) -> None:
        published_claims = {
            claim_id
            for path in PAGES.values()
            for claim_id in parse_page(path).claim_ids
        }
        self.assertEqual(set(claim_rows()), published_claims)

    def test_public_asset_mirrors_match_reviewed_media(self) -> None:
        # Runtime assets under public/ must be byte-identical to the reviewed
        # canonical copies in docs/content/assets, so the media ledger's
        # hashes govern what actually ships.
        public_assets = CONTENT_ROOT.parents[1] / "public" / "assets"
        if not public_assets.exists():
            return
        for public_file in public_assets.iterdir():
            if not public_file.is_file():
                continue
            with self.subTest(asset=public_file.name):
                canonical = CONTENT_ROOT / "assets" / public_file.name
                self.assertTrue(canonical.is_file(), f"No reviewed canonical copy for {public_file.name}")
                self.assertFalse(public_file.is_symlink(), f"public asset must be a real file: {public_file.name}")
                self.assertEqual(
                    hashlib.sha256(public_file.read_bytes()).hexdigest(),
                    hashlib.sha256(canonical.read_bytes()).hexdigest(),
                    f"public/assets/{public_file.name} drifted from docs/content/assets",
                )

    def test_unsafe_athena_captures_are_absent_and_unreferenced(self) -> None:
        for filename in UNSAFE_ATHENA_ASSETS:
            self.assertFalse((CONTENT_ROOT / "assets" / filename).exists(), filename)
        for html_path in CONTENT_ROOT.rglob("*.html"):
            html = html_path.read_text(encoding="utf-8")
            for filename in UNSAFE_ATHENA_ASSETS:
                self.assertNotIn(filename, html, f"Unsafe asset referenced by {html_path}")

    def test_published_media_is_approved_and_hash_matched(self) -> None:
        ledger = evidence_rows()
        local_media_refs: set[Path] = set()
        for html_path in CONTENT_ROOT.rglob("*.html"):
            parser = parse_page(html_path)
            for reference in parser.media_refs:
                destination = resolve_site_reference(html_path, reference)
                if destination is not None and destination.suffix.lower() in MEDIA_SUFFIXES:
                    local_media_refs.add(destination)
            for reference in re.findall(r"url\(\s*['\"]?([^)'\"]+)", html_path.read_text(encoding="utf-8")):
                destination = resolve_site_reference(html_path, reference)
                if destination is not None and destination.suffix.lower() in MEDIA_SUFFIXES:
                    local_media_refs.add(destination)
        for css_path in CONTENT_ROOT.rglob("*.css"):
            for reference in re.findall(r"url\(\s*['\"]?([^)'\"]+)", css_path.read_text(encoding="utf-8")):
                destination = resolve_site_reference(css_path, reference)
                if destination is not None and destination.suffix.lower() in MEDIA_SUFFIXES:
                    local_media_refs.add(destination)

        for media_path in local_media_refs:
            with self.subTest(media=media_path):
                self.assertTrue(media_path.is_file(), f"Missing media: {media_path}")
                if not media_path.is_relative_to(CONTENT_ROOT):
                    # Files served straight from public/ (the resume PDF) are
                    # documents, not reviewed evidence media. Anything under
                    # public/assets is still held to the reviewed canonical
                    # copies by test_public_asset_mirrors_match_reviewed_media.
                    continue
                public_path = media_path.relative_to(CONTENT_ROOT).as_posix()
                row = ledger.get(public_path)
                self.assertIsNotNone(row, f"Media lacks evidence approval: {public_path}")
                self.assertEqual(row["decision"], "approved")
                actual_hash = hashlib.sha256(media_path.read_bytes()).hexdigest()
                self.assertEqual(row["hash"], actual_hash)

        for media_path in CONTENT_ROOT.rglob("*"):
            if not media_path.is_file() or media_path.suffix.lower() not in MEDIA_SUFFIXES:
                continue
            if "athena" not in media_path.as_posix().lower():
                continue
            public_path = media_path.relative_to(CONTENT_ROOT).as_posix()
            row = ledger.get(public_path)
            self.assertIsNotNone(row, f"Athena media lacks ledger entry: {public_path}")
            self.assertEqual(row["decision"], "approved")


if __name__ == "__main__":
    unittest.main()
