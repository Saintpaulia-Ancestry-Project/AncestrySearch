# Import summary

- cultivars.csv: 30626 rows (named from sources: 4764; stubs from parents: 1024)
- kinds: {'seedling': 237, 'cultivar': 29865, 'stub': 471, 'species': 53}
- sources: {'xlsx': 1059, 'xlsx+mvl_supp': 1206, 'xlsx+sqlite+mvl_supp': 101, 'xlsx+supplement': 396, 'xlsx+sqlite': 99, 'xlsx+supplement+mvl_supp': 26, 'xlsx+masterlist1963': 23, 'xlsx+sqlite+supplement': 79, 'xlsx+sqlite+supplement+mvl_supp': 3, 'xlsx+masterlist1963+mvl_supp': 3, 'xlsx+supplement+masterlist1963': 1, 'sqlite+mvl_supp': 527, 'sqlite': 276, 'sqlite+supplement': 196, 'sqlite+supplement+mvl_supp': 10, 'sqlite+masterlist1963': 2, 'supplement': 748, 'supplement+mvl_supp': 9, 'parent': 700, 'parent+mvl_supp': 324, 'masterlist1963': 12656, 'masterlist1963+mvl_supp': 109, 'mvl_supp': 12073}
- parentage.csv: 5362; people.csv: 1909; cultivar_hybridizers.csv: 24761; cultivar_links.csv: 12
- SQLite rows dropped by review decisions: 5
- new hybridizer strings appended to hybridizer_mapping.csv: 0
- reviewer corrections applied (data_corrections.csv): 20
- parent corrections applied (parent_corrections.csv): 7
- 1963 Master List: {'new': 12765, 'joined_auto': 29, 'groups': 12794, 'review': 412}
- Master List supplements 1964-2002: {'new': 12073, 'spelling_unchecked': 3453, 'joined_auto': 1989, 'joined_decision': 339, 'crossrefs': 1174, 'plants': 14401, 'held_back': 1259, 'review_rows': 2739}
- parents written 'Name (Originator)': {'joined: originator agrees': 1, 'separate record with its originator': 2, 'review': 0}
- originators written as text, now people: {'originators': 1683, 'with a proposed link': 95, 'linked by decision': 5, 'auto-linked (I. Surname = Surname, I.)': 68}
- sports linked: 816
- with registration no.: 8399
- name near-miss candidates written for review: (file exists; decisions applied: 85)

## Flags by category

- supplement_conflict: 168
- placeholder_parent: 134
- sport_conflict_sqlite_wins: 11
- xlsx_conflicting_duplicate: 8
- mvl_registration_taken: 7
- hybridizer_listed_twice: 5
- sport_without_parent: 2
- sport_two_parents: 2
- parent_is_self: 1