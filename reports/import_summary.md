# Import summary

- cultivars.csv: 31387 rows (named from sources: 5011; stubs from parents: 1022)
- kinds: {'seedling': 237, 'cultivar': 30631, 'stub': 466, 'species': 53}
- sources: {'xlsx': 790, 'xlsx+mvl_supp': 1256, 'xlsx+sqlite+mvl_supp': 105, 'xlsx+supplement': 598, 'xlsx+sqlite+supplement': 116, 'xlsx+sqlite': 54, 'xlsx+supplement+mvl_supp': 43, 'xlsx+sqlite+supplement+mvl_supp': 7, 'xlsx+masterlist1963': 23, 'xlsx+masterlist1963+mvl_supp': 3, 'xlsx+supplement+masterlist1963': 1, 'sqlite+mvl_supp': 565, 'sqlite': 224, 'sqlite+supplement': 210, 'sqlite+supplement+mvl_supp': 10, 'sqlite+masterlist1963': 2, 'supplement': 994, 'supplement+mvl_supp': 10, 'parent': 695, 'parent+mvl_supp': 327, 'masterlist1963': 12651, 'masterlist1963+mvl_supp': 114, 'mvl_supp': 12589}
- parentage.csv: 5362; people.csv: 1977; cultivar_hybridizers.csv: 25543; cultivar_links.csv: 12
- SQLite rows dropped by review decisions: 5
- new hybridizer strings appended to hybridizer_mapping.csv: 29
- reviewer corrections applied (data_corrections.csv): 44
- parent corrections applied (parent_corrections.csv): 7
- 1963 Master List: {'new': 12765, 'joined_auto': 29, 'groups': 12794, 'review': 426}
- Master List supplements 1964-2002: {'new': 12589, 'spelling_unchecked': 3603, 'joined_auto': 2109, 'joined_decision': 342, 'crossrefs': 1218, 'plants': 15040, 'held_back': 614, 'review_rows': 2873}
- parents written 'Name (Originator)': {'joined: originator agrees': 1, 'separate record with its originator': 2, 'review': 0}
- originators written as text, now people: {'originators': 1724, 'with a proposed link': 111, 'linked by decision': 5, 'auto-linked (I. Surname = Surname, I.)': 80}
- sports linked: 816
- with registration no.: 9225
- name near-miss candidates written for review: (file exists; decisions applied: 89)

## Flags by category

- supplement_conflict: 185
- placeholder_parent: 134
- sport_conflict_sqlite_wins: 11
- xlsx_conflicting_duplicate: 8
- hybridizer_listed_twice: 5
- sport_without_parent: 2
- sport_two_parents: 2
- parent_is_self: 1
- mvl_registration_taken: 1