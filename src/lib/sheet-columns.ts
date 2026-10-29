// The feeding sheet's columns (6fe63c9b, step 2): the day's chosen feeds AND every feed already given that day; with no choice,
// the given ones. Never "Egyéb" (it takes its real name per item, on the item form). A feed given but not chosen stays a column:
// a list picked or the day's feeds changed after an item was recorded would otherwise hide that item from the sheet (barracuda
// on #104: the animal a list keeps keeps its item, and the sheet must still show it). Pure, tested without a page.
export function sheetColumnFeeds<F extends { id: string; isOther?: boolean }>(feeds: F[], chosenIds: Iterable<string>, givenIds: Iterable<string>): F[] {
  const chosen = new Set(chosenIds);
  const given = new Set(givenIds);
  return feeds.filter((f) => !f.isOther && (chosen.has(f.id) || given.has(f.id)));
}
