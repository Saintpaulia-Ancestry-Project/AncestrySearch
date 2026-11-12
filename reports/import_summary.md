# Import summary

- cultivars.csv: 29229 rows (named from sources: 4764; stubs from parents: 1024)
- kinds: {'seedling': 237, 'cultivar': 28471, 'stub': 468, 'species': 53}
- sources: {'xlsx': 1156, 'xlsx+mvl_supp': 1109, 'xlsx+sqlite+mvl_supp': 91, 'xlsx+supplement': 396, 'xlsx+sqlite': 109, 'xlsx+supplement+mvl_supp': 26, 'xlsx+masterlist1963': 23, 'xlsx+sqlite+supplement': 79, 'xlsx+sqlite+supplement+mvl_supp': 3, 'xlsx+masterlist1963+mvl_supp': 3, 'xlsx+supplement+masterlist1963': 1, 'sqlite+mvl_supp': 467, 'sqlite': 336, 'sqlite+supplement': 196, 'sqlite+supplement+mvl_supp': 10, 'sqlite+masterlist1963': 2, 'supplement': 748, 'supplement+mvl_supp': 9, 'parent': 697, 'parent+mvl_supp': 327, 'masterlist1963': 12656, 'masterlist1963+mvl_supp': 109, 'mvl_supp': 10676}
- parentage.csv: 5362; people.csv: 1691; cultivar_hybridizers.csv: 23301; cultivar_links.csv: 12
- SQLite rows dropped by review decisions: 5
- new hybridizer strings appended to hybridizer_mapping.csv: 0
- reviewer corrections applied (data_corrections.csv): 20
- parent corrections applied (parent_corrections.csv): 7
- 1963 Master List: {'new': 12765, 'joined_auto': 29, 'groups': 12794, 'review': 412}
- Master List supplements 1964-2002: {'new': 10676, 'spelling_unchecked': 3391, 'joined_auto': 1819, 'joined_decision': 343, 'crossrefs': 863, 'plants': 12838, 'held_back': 985, 'review_rows': 2465}
- parents written 'Name (Originator)': {'joined: originator agrees': 1, 'separate record with its originator': 2, 'review': 0}
- originators written as text, now people: {'originators': 1450, 'with a proposed link': 100, 'linked by decision': 5, 'auto-linked (I. Surname = Surname, I.)': 67}
- sports linked: 816
- with registration no.: 7035
- name near-miss candidates written for review: (file exists; decisions applied: 85)

## Flags by category

- supplement_conflict: 168
- placeholder_parent: 134
- sport_conflict_sqlite_wins: 11
- xlsx_conflicting_duplicate: 8
- hybridizer_listed_twice: 5
- sport_without_parent: 2
- sport_two_parents: 2
- mvl_registration_taken: 2
- parent_is_self: 1