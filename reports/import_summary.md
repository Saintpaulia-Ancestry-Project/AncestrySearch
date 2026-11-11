# Import summary

- cultivars.csv: 18555 rows (named from sources: 4765; stubs from parents: 1025)
- kinds: {'seedling': 237, 'cultivar': 17496, 'stub': 796, 'species': 26}
- sources: {'xlsx': 2266, 'xlsx+sqlite': 200, 'xlsx+supplement': 421, 'xlsx+masterlist1963': 26, 'xlsx+sqlite+supplement': 82, 'xlsx+supplement+masterlist1963': 1, 'sqlite': 803, 'sqlite+supplement': 206, 'sqlite+masterlist1963': 2, 'supplement': 758, 'parent': 1025, 'masterlist1963': 12765}
- parentage.csv: 5364; people.csv: 857; cultivar_hybridizers.csv: 12161; cultivar_links.csv: 13
- SQLite rows dropped by review decisions: 5
- new hybridizer strings appended to hybridizer_mapping.csv: 0
- reviewer corrections applied (data_corrections.csv): 19
- parent corrections applied (parent_corrections.csv): 2
- 1963 Master List: {'new': 12765, 'joined_auto': 29, 'groups': 12794, 'review': 412}
- parents written 'Name (Originator)': {'joined: originator agrees': 1, 'separate record with its originator': 2, 'review': 0}
- originators written as text, now people: {'originators': 507, 'with a proposed link': 43, 'linked by decision': 1}
- sports linked: 816
- with registration no.: 2009
- name near-miss candidates written for review: (file exists; decisions applied: 76)

## Flags by category

- supplement_conflict: 168
- placeholder_parent: 132
- sport_conflict_sqlite_wins: 11
- xlsx_conflicting_duplicate: 8
- hybridizer_listed_twice: 5
- sport_without_parent: 2
- sport_two_parents: 2
- parent_is_self: 1