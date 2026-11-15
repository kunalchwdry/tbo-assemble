# Indian domestic route data: source assessment

Assessment date: 13 November 2026. The app now supplements the historical Vonter DGCA-derived CSV (observed ending in July 2026) with newer official DGCA workbooks, for the six supported routes. Their stale-data and validation gates remain in force. See [India travel data methodology](india-market-data.md) for the integration and source-hash format.

## Primary source: DGCA domestic city-pair workbooks

DGCA's [monthly statistics portal](https://dgca.gov.in/digigov-portal/?main259%2F4184%2Fservicename=&page=monthlyStatistics%2F259%2F5000%2Fhtml) listed August and September 2026 city-pair files. The corresponding original public workbooks were downloaded and inspected:

- [August 2026 workbook](https://public-prd-dgca.s3.ap-south-1.amazonaws.com/InventoryList/dataReports/aviationDataStatistics/airTransport/domestic/monthly/DOM%20CITYPAIR%20DATA%2C%20AUGUST%202026.xlsx): SHA-256 `5d282ca14c75df46902a94fa1c2f2df9274246cd0565e4a271cc168b33f1db53`.
- [September 2026 workbook](https://public-prd-dgca.s3.ap-south-1.amazonaws.com/InventoryList/dataReports/aviationDataStatistics/airTransport/domestic/monthly/DOM%20CITYPAIR%20DATA%2C%20SEPTEMBER%202026.xlsx): SHA-256 `211c492dd987b916d46fa397381e3fc69e3d487e21b1872c74338c2dcf0bc893`.

Hashes identify the files inspected; the mutable links may later serve revised bytes. Both workbooks label their statistics **provisional**, and contain passenger counts for scheduled domestic services, not TBO searches, bookings, fares, or available inventory. Column directions are from city 1 to city 2 and from city 2 to city 1.

| September 2026 original pair | City 1 → city 2 | City 2 → city 1 |
| --- | ---: | ---: |
| Delhi – Mumbai (Mumbai) | 253,634 | 246,253 |
| Delhi – Mumbai (Navi Mumbai) | 20,481 | 20,033 |
| Delhi – Pune | 107,712 | 106,901 |
| Bengaluru – Delhi | 196,410 | 193,923 |

The [Dataful preview](https://dataful.in/datasets/14866/) also lists September 2026 directional city-pair values; its simplified Mumbai label omits the airport distinction. The official workbook is preferable as it retains the exact labels, so do not merge Navi Mumbai with Mumbai (Mumbai). Dataful download availability and application redistribution rights were not established; its [terms](https://dataful.in/terms-and-conditions) describe restrictions and subscriptions. No Dataful download or paid service is needed for the source identified here.

DGCA's [website policy](https://www.dgca.gov.in/digigov-portal/jsp/dgca/footerLink/WebsitePolicy.jsp) says website material may be reproduced free of charge if accurately reproduced and prominently attributed, with an exception for third-party copyrighted material. Confirm applicability and operational reuse requirements before republishing or building an automated production pipeline.

## Integration and remaining limitations

The app discovers newer workbooks through the official index and checks file size, workbook month and passenger headers, directional city-pair duplicates, and exact Mumbai labels. Per-row file hashes and a separate combined manifest hash retain mixed-source provenance in v4 snapshots. Missing and ambiguous values are not filled. It fails closed on source discovery errors rather than silently masking an outage; upstream format changes may require maintenance. Direct parsing of downloaded workbooks still adds security and availability considerations. As of November, September remains older than the last completed month, so the existing strict forecast gate flags it stale. The frozen February–July comparison is unchanged, and the supplemented source does not turn the passenger proxy into TBO transaction data.
