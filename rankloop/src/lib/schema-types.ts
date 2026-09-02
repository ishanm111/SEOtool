/**
 * What a schema.org @type actually means.
 *
 * schema.org is a type hierarchy, and a site marks itself up with the most
 * specific type it can: a liquor store writes `LiquorStore`, a dentist writes
 * `Dentist`, a garage writes `AutoRepair`. Every one of those IS a
 * `LocalBusiness` by inheritance, and none of them contain the string.
 *
 * Matching the literal word therefore reads correct markup as missing markup —
 * which then gets reported to a client as a fault and "fixed" by replacing a
 * precise type with a vaguer one. The subtype list below is what stops that.
 *
 * Shared by detection, findings, competitor scoring and the recommendations
 * engine so a type means the same thing everywhere it is judged.
 */

/**
 * LocalBusiness subtypes whose names carry no shared suffix, so no pattern can
 * catch them. Everything with a regular ending ("…Store", "…Business",
 * "…Service") is handled by SUBTYPE_SUFFIX instead of being listed here.
 */
const LOCAL_BUSINESS_TYPES = new Set(
  [
    'LocalBusiness',
    'Organization',
    // food and drink
    'Restaurant', 'CafeOrCoffeeShop', 'BarOrPub', 'Bakery', 'Brewery', 'Winery',
    'Distillery', 'FastFoodRestaurant', 'IceCreamShop', 'FoodEstablishment',
    // retail
    'LiquorStore', 'GroceryStore', 'ConvenienceStore', 'DepartmentStore',
    'Pharmacy', 'Florist', 'ClothingStore', 'ShoeStore', 'JewelryStore',
    'BookStore', 'ToyStore', 'PetStore', 'HardwareStore', 'FurnitureStore',
    'ElectronicsStore', 'MobilePhoneStore', 'BikeStore', 'GardenStore',
    'OfficeEquipmentStore', 'MusicStore', 'SportingGoodsStore', 'TireShop',
    'AutoPartsStore', 'HobbyShop', 'Store',
    // health
    'Dentist', 'Physician', 'MedicalClinic', 'Optician', 'VeterinaryCare',
    'MedicalBusiness', 'Hospital', 'HealthClub', 'DaySpa', 'BeautySalon',
    'HairSalon', 'NailSalon', 'TattooParlor',
    // trades and professional
    'Plumber', 'Electrician', 'Locksmith', 'RoofingContractor', 'HVACBusiness',
    'HousePainter', 'MovingCompany', 'GeneralContractor', 'Attorney',
    'AccountingService', 'InsuranceAgency', 'RealEstateAgent', 'TravelAgency',
    'Notary', 'EmploymentAgency', 'ProfessionalService',
    'HomeAndConstructionBusiness', 'LegalService', 'FinancialService',
    // automotive
    'AutoRepair', 'AutoDealer', 'AutoBodyShop', 'AutoWash', 'GasStation',
    'MotorcycleDealer', 'MotorcycleRepair', 'AutomotiveBusiness',
    // lodging, leisure, other
    'Hotel', 'Motel', 'BedAndBreakfast', 'Resort', 'Campground',
    'LodgingBusiness', 'GolfCourse', 'Gym', 'SportsClub', 'Casino',
    'MovieTheater', 'NightClub', 'ChildCare', 'Dryclean', 'DryCleaningOrLaundry',
    'SelfStorage', 'Library', 'Museum', 'RecyclingCenter', 'Church',
    'EntertainmentBusiness', 'SportsActivityLocation', 'EmergencyService',
    'GovernmentOffice', 'InternetCafe', 'ArtGallery',
  ].map((t) => t.toLowerCase()),
)

/**
 * Endings that only appear on LocalBusiness subtypes. This is what makes the
 * check survive schema.org adding types faster than anyone updates a list.
 */
const SUBTYPE_SUFFIX =
  /(?:business|store|shop|service|servicing|salon|clinic|dealer|contractor|repair|rental|agency|restaurant|market|studio|garage|parlor|parlour)$/i

/** True for LocalBusiness and any of its subtypes, however specific. */
export function isLocalBusinessType(type: string): boolean {
  const t = type.trim().replace(/^https?:\/\/schema\.org\//i, '')
  if (!t) return false
  return LOCAL_BUSINESS_TYPES.has(t.toLowerCase()) || SUBTYPE_SUFFIX.test(t)
}

/** True for the product and offer family used by online stores. */
export function isProductType(type: string): boolean {
  return /^(?:Product|ProductModel|IndividualProduct|SomeProducts|Offer|AggregateOffer|OfferCatalog)$/i.test(
    type.trim().replace(/^https?:\/\/schema\.org\//i, ''),
  )
}

/** True for the FAQ family. */
export function isFaqType(type: string): boolean {
  return /^(?:FAQPage|QAPage|Question)$/i.test(type.trim().replace(/^https?:\/\/schema\.org\//i, ''))
}

/** Whether a page carries business markup of the kind this client should have. */
export function hasBusinessSchema(types: string[], businessType: string): boolean {
  return businessType === 'ecommerce' ? types.some(isProductType) : types.some(isLocalBusinessType)
}

/**
 * The most specific business type on a page, so a recommendation can say
 * "you already have LiquorStore" instead of demanding a generic one.
 */
export function mostSpecificBusinessType(types: string[]): string | null {
  const matches = types.filter(isLocalBusinessType)
  if (matches.length === 0) return null
  const specific = matches.filter((t) => !/^(?:LocalBusiness|Organization|Store)$/i.test(t))
  return (specific.length ? specific : matches).sort((a, b) => b.length - a.length)[0]
}
