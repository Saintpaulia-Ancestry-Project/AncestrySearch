# Import summary

- cultivars.csv: 30707 rows (named from sources: 4764; stubs from parents: 1024)
- kinds: {'seedling': 237, 'cultivar': 29949, 'stub': 468, 'species': 53}
- sources: {'xlsx': 1029, 'xlsx+mvl_supp': 1236, 'xlsx+sqlite+mvl_supp': 105, 'xlsx+supplement': 396, 'xlsx+sqlite': 95, 'xlsx+supplement+mvl_supp': 26, 'xlsx+masterlist1963': 23, 'xlsx+sqlite+supplement': 79, 'xlsx+sqlite+supplement+mvl_supp': 3, 'xlsx+masterlist1963+mvl_supp': 3, 'xlsx+supplement+masterlist1963': 1, 'sqlite+mvl_supp': 538, 'sqlite': 265, 'sqlite+supplement': 196, 'sqlite+supplement+mvl_supp': 10, 'sqlite+masterlist1963': 2, 'supplement': 748, 'supplement+mvl_supp': 9, 'parent': 697, 'parent+mvl_supp': 327, 'masterlist1963': 12656, 'masterlist1963+mvl_supp': 109, 'mvl_supp': 12154}
- parentage.csv: 5362; people.csv: 1921; cultivar_hybridizers.csv: 24845; cultivar_links.csv: 12
- SQLite rows dropped by review decisions: 5
- new hybridizer strings appended to hybridizer_mapping.csv: 0
- reviewer corrections applied (data_corrections.csv): 20
- parent corrections applied (parent_corrections.csv): 7
- 1963 Master List: {'new': 12765, 'joined_auto': 29, 'groups': 12794, 'review': 412}
- Master List supplements 1964-2002: {'new': 12154, 'spelling_unchecked': 3453, 'joined_auto': 2035, 'joined_decision': 342, 'crossrefs': 1190, 'plants': 14531, 'held_back': 1129, 'review_rows': 2762}
- parents written 'Name (Originator)': {'joined: originator agrees': 1, 'separate record with its originator': 2, 'review': 0}
- originators written as text, now people: {'originators': 1694, 'with a proposed link': 96, 'linked by decision': 5, 'auto-linked (I. Surname = Surname, I.)': 68}
- sports linked: 816
- with registration no.: 8516
- name near-miss candidates written for review: (file exists; decisions applied: 89)

## Flags by category

- supplement_conflict: 168
- placeholder_parent: 134
- sport_conflict_sqlite_wins: 11
- xlsx_conflicting_duplicate: 8
- hybridizer_listed_twice: 5
- sport_without_parent: 2
- sport_two_parents: 2
- parent_is_self: 1
- mvl_registration_taken: 1