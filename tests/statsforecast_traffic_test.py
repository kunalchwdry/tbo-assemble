"""Offline model protocol checks, synthetic data only; run with statsforecast env."""
import unittest
from copy import deepcopy
from scripts.statsforecast_traffic import shift_month,usable_map,history_for_target,replay_target,score,choose,study

def all_rows():
    return [{'month':shift_month('2020-01',i),'passengers':1000+i*10,'quality':'ok'} for i in range(90)]

def fake_fit(y):
    return {'ses-optimized':float(y[-1]),'seasonal-auto-ets':float(y[-12])}

class Tests(unittest.TestCase):
    def test_replay_does_not_train_on_cutoff_plus_one_or_later(self):
        series=usable_map(all_rows());a=replay_target(series,'2025-04',fake_fit)
        altered=deepcopy(series)
        for month in list(altered):
            if month>'2025-02' and month!='2025-04': altered[month]=9_999_999
        b=replay_target(altered,'2025-04',fake_fit)
        self.assertEqual(a,b);self.assertEqual(a['cutoff'],'2025-02');self.assertEqual(len(history_for_target(series,'2025-04')[0]),36)
    def test_missing_is_causally_imputed_and_ambiguous_cutoff_excluded(self):
        rows=all_rows();series=usable_map(rows);del series['2024-05'];h=history_for_target(series,'2025-03')
        self.assertIn('2024-05',h[1]);self.assertEqual(h[0][[shift_month('2025-01',k) for k in range(-35,1)].index('2024-05')],series['2023-05'])
        del series['2025-01'];self.assertIsNone(history_for_target(series,'2025-03'))
        duplicates=rows+[dict(next(r for r in rows if r['month']=='2024-01'))];self.assertNotIn('2024-01',usable_map(duplicates))
    def test_selection_uses_earlier_period_only_and_falls_back(self):
        def row(n):return {'actual':100,'predictions':{'last-observed':110,'last-year':120,'ses-optimized':100+n,'seasonal-auto-ets':150}}
        a=[row(1)]*12;self.assertEqual(choose(a),'ses-optimized');self.assertIsNone(choose(a[:11]))
        self.assertEqual(choose([row(9.7)]*12),'last-observed')
        route={'origin':'DEL','destination':'PNQ','retrievedAt':'x','sourceManifestSha256':'h','rowsSha256':'h','monthly':all_rows()}
        before=study(route,fake_fit);altered=deepcopy(route)
        for r in altered['monthly']:
            if r['month']>='2026-02':r['passengers']=999999
        after=study(altered,fake_fit);self.assertEqual(before['selectedPolicy'],after['selectedPolicy']);self.assertEqual(before['selection'],after['selection'])
    def test_all_methods_share_same_rows_and_fitting_error_is_skipped(self):
        data=usable_map(all_rows());self.assertIsNone(replay_target(data,'2025-04',lambda _: (_ for _ in ()).throw(ValueError('fit failed'))))
        r=replay_target(data,'2025-04',fake_fit);self.assertEqual(set(score([r])),{'last-observed','last-year','ses-optimized','seasonal-auto-ets'})

if __name__=='__main__': unittest.main()
