// The public portfolio gallery: the atelier's published work, plus the filter
// chips derived from it.
//
// Thin by design. Everything that decides *whether* a piece is public happens in
// the Notion read (`isPublishable`), and everything that decides *what can be
// filtered on* happens in the pure extractor beside it — so there is one place
// to reason about publication and one place to reason about facets, and this
// only puts the two halves in the same response.

import { listPublishedPortfolioPieces } from "../lib/notion/portfolio.repository.js";
import {
  derivePortfolioFilters,
  type PortfolioFilterRecord,
  type PortfolioPieceRecord,
} from "../lib/notion/portfolio.schema.js";

export interface PortfolioView {
  pieces: PortfolioPieceRecord[];
  filters: PortfolioFilterRecord[];
}

/**
 * The gallery, newest first, with its chip groups.
 *
 * The filters are derived from the **pieces being served**, not from the
 * database's option lists, which is what keeps the two consistent: a chip can
 * never offer a value that filters the grid to nothing, because every option
 * came off a piece in the same response.
 */
export async function getPortfolio(): Promise<PortfolioView> {
  const pieces = await listPublishedPortfolioPieces();
  return { pieces, filters: derivePortfolioFilters(pieces) };
}
