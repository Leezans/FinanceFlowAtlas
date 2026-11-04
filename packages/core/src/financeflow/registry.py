import pycountry
from .contracts import Country
SOURCE = 'ISO 3166-1 registry via pycountry; territories included without sovereignty inference'
def countries(reporters=(),counterparts=()):
    return [Country(iso3=c.alpha_3,iso2=c.alpha_2,numeric=c.numeric,name=c.name,coverage='reporter' if c.alpha_3 in reporters else 'counterpart_only' if c.alpha_3 in counterparts else 'no_observations') for c in sorted(pycountry.countries,key=lambda c:c.alpha_3)]
