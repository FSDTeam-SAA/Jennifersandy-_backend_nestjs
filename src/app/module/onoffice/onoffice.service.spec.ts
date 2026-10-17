import { of } from 'rxjs';
import { OnofficeService } from './onoffice.service';

const fieldDefinitions = {
  veroeffentlichen: { type: 'boolean' },
  status: { type: 'singleselect', permittedvalues: { '1': 'Aktiv' } },
  vermarktungsart: {
    type: 'singleselect',
    permittedvalues: { miete: 'Miete', kauf: 'Kauf' },
  },
  verkauft: { type: 'boolean' },
  reserviert: { type: 'boolean' },
  objektart: { type: 'singleselect', permittedvalues: { wohnung: 'Wohnung' } },
  objekttyp: { type: 'singleselect', permittedvalues: {} },
  warmmiete: {},
  kaltmiete: {},
  kaufpreis: {},
  verfuegbar_ab: {},
  objekttitel: {},
  miete_pauschal: {},
  miete_pauschal_pro: {
    type: 'singleselect',
    permittedvalues: { T: 'Tag', W: 'Woche', M: 'Monat' },
  },
  status2: {
    type: 'singleselect',
    permittedvalues: {
      ind_Schl_2897: 'IN VERMIETUNG',
      status2obj_aktiv: 'IM VERKAUF',
      ind_Schl_3003: 'BESTAND',
    },
  },
  abdatum: {},
  ind_1768_Feld_ObjKategorie10: {
    type: 'singleselect',
    permittedvalues: {
      ind_Schl_2907: 'leerstehend',
      ind_Schl_2905: 'teilweise leerstehend',
      ind_Schl_2909: 'vermietet',
    },
  },
};

function response(records: any[], total: number | null = records.length) {
  return {
    data: {
      response: {
        results: [
          {
            status: { errorcode: 0 },
            data: { records, meta: { cntabsolute: total } },
          },
        ],
      },
    },
  };
}

function estate(id: number, elements: Record<string, any> = {}) {
  return {
    id,
    elements: {
      veroeffentlichen: 1,
      status: 1,
      status2: 'ind_Schl_2897',
      showGoogleMap: true,
      vermarktungsart: 'miete',
      verkauft: 0,
      reserviert: 0,
      kaltmiete: 800,
      warmmiete: 1000,
      kaufpreis: 350000,
      objekttitel: `Wohnung ${id}`,
      ...elements,
    },
  };
}

describe('onOffice publication, prices and sync safety', () => {
  let service: OnofficeService;
  let http: { post: jest.Mock };
  let model: any;

  beforeEach(() => {
    delete process.env.ONOFFICE_ALLOWED_MARKETING_STATUSES;
    const query: any = {
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      sort: jest.fn().mockResolvedValue([]),
      lean: jest.fn().mockResolvedValue([]),
    };
    model = {
      findOneAndUpdate: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ modifiedCount: 2 }),
      find: jest.fn().mockReturnValue(query),
      countDocuments: jest.fn().mockResolvedValue(0),
    };
    http = { post: jest.fn() };
    service = new OnofficeService(http as any, model);
    jest
      .spyOn(service as any, 'getCredentials')
      .mockReturnValue({
        token: 'test',
        secret: 'test',
        pictureToken: 'test',
        pictureSecret: 'test',
      });
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => jest.restoreAllMocks());

  function mockApi(estates: any[]) {
    http.post.mockImplementation((_url, body) => {
      const action = body.request.actions[0];
      if (action.resourcetype === 'fields')
        return of(response([{ id: 'estate', elements: fieldDefinitions }]));
      if (action.resourcetype === 'estatepictures') return of(response([]));
      const cursor = action.parameters.filter.Id?.[0].val ?? 0;
      const page = estates.filter((record) => record.id > cursor).slice(0, 500);
      return of(
        response(page, estates.filter((record) => record.id > cursor).length),
      );
    });
  }

  it('keeps purchase prices separate from monthly rent and preserves German labels alongside codes', async () => {
    mockApi([
      estate(1, {
        vermarktungsart: 'kauf',
        verkauft: 1,
        objektart: 'wohnung',
        objekttyp: 'internal_unknown_code',
      }),
    ]);
    await service.fullSync();
    const saved = model.findOneAndUpdate.mock.calls[0][1].$set;
    expect(saved).toMatchObject({
      vermarktungsart: 'kauf',
      vermarktungsartLabel: 'Kauf',
      objektartLabel: 'Wohnung',
      objekttypLabel: '',
      price: 350000,
      priceType: 'purchase',
      pricePeriod: null,
      rentalStatus: 'sold',
      rentalStatusLabel: 'Verkauft',
      veroeffentlichen: '1',
    });
    const request = http.post.mock.calls.find(
      (call) => call[1].request.actions[0].resourcetype === 'estate',
    )[1];
    expect(request.request.actions[0].parameters.filter).toMatchObject({
      veroeffentlichen: [{ op: '=', val: 1 }],
      status: [{ op: '=', val: 1 }],
    });
  });

  it('uses warm rent for a rental and never falls back to its purchase price', async () => {
    mockApi([
      estate(1),
      estate(2, { kaltmiete: 0, warmmiete: 0 }),
      estate(3, { warmmiete: 0, reserviert: 1 }),
    ]);
    await service.fullSync();
    const saved = model.findOneAndUpdate.mock.calls.map(
      (call: any) => call[1].$set,
    );
    expect(saved[0]).toMatchObject({
      price: 1000,
      priceType: 'rent',
      pricePeriod: 'month',
      priceLabel: 'Warmmiete',
    });
    expect(saved[1]).toMatchObject({ price: null, priceType: 'rent' });
    expect(saved[2]).toMatchObject({
      price: 800,
      priceLabel: 'Kaltmiete',
      rentalStatus: 'reserved',
    });
  });

  it('maps the marketing rental status and retains non-date availability text', async () => {
    mockApi([
      estate(1, { verkauft: 1, verfuegbar_ab: 'nach Vereinbarung' }),
      estate(2, { verfuegbar_ab: '01.11.2026' }),
    ]);
    await service.fullSync();
    expect(model.findOneAndUpdate.mock.calls[0][1].$set).toMatchObject({
      rentalStatus: 'rented',
      verfuegbar_ab: null,
      verfuegbarAbText: 'nach Vereinbarung',
    });
    expect(model.findOneAndUpdate.mock.calls[1][1].$set.verfuegbar_ab).toEqual(
      new Date('2026-11-01'),
    );
  });

  it('fetches all pages and batches images before deactivating records missing from a complete sync', async () => {
    const estates = Array.from({ length: 501 }, (_, index) =>
      estate(index + 1),
    );
    mockApi(estates);
    const result = await service.fullSync();
    expect(result).toMatchObject({ total: 501, synced: 501, complete: true });
    const estateRequests = http.post.mock.calls.filter(
      (call) =>
        call[1].request.actions[0].resourcetype === 'estate' &&
        !call[1].request.actions[0].parameters.formatoutput,
    );
    expect(estateRequests).toHaveLength(2);
    expect(
      estateRequests[1][1].request.actions[0].parameters.filter.Id,
    ).toEqual([{ op: '>', val: 500 }]);
    expect(model.updateMany.mock.calls[0][0].onofficeId.$nin).toHaveLength(501);
  });

  it('handles a verified empty published set by removing stale visibility', async () => {
    mockApi([]);
    expect(await service.fullSync()).toMatchObject({
      total: 0,
      synced: 0,
      complete: true,
    });
    expect(model.updateMany).toHaveBeenCalledWith(
      { onofficeId: { $nin: [] }, isActive: true },
      { $set: { isActive: false } },
    );
    expect(
      http.post.mock.calls.some(
        (call) => call[1].request.actions[0].resourcetype === 'estatepictures',
      ),
    ).toBe(false);
  });

  it('requests special publication/status fields even when field definitions omit them', async () => {
    mockApi([estate(1)]);
    const original = http.post.getMockImplementation()!;
    const {
      status,
      veroeffentlichen,
      verkauft,
      reserviert,
      ...accountDefinitions
    } = fieldDefinitions;
    http.post.mockImplementation((url, body) =>
      body.request.actions[0].resourcetype === 'fields'
        ? of(response([{ id: 'estate', elements: accountDefinitions }]))
        : original(url, body),
    );
    await service.fullSync();
    const request = http.post.mock.calls.find(
      (call) => call[1].request.actions[0].resourcetype === 'estate',
    )[1];
    expect(request.request.actions[0].parameters.data).toEqual(
      expect.arrayContaining([
        'Id',
        'status',
        'veroeffentlichen',
        'verkauft',
        'reserviert',
      ]),
    );
    expect(model.findOneAndUpdate.mock.calls[0][1].$set.statusLabel).toBe(
      'Aktiv',
    );
  });

  it.each([
    ['M', 'month'],
    ['W', 'week'],
    ['T', 'day'],
    ['', null],
  ])(
    'uses real all-inclusive rent with period %s without mislabelling its billing interval',
    async (period, expected) => {
      mockApi([
        estate(1, {
          miete_pauschal: '1600.00',
          miete_pauschal_pro: period,
          abdatum: '2026-12-01',
          verfuegbar_ab: 'Dezember',
          ind_1768_Feld_ObjKategorie10: 'ind_Schl_2907',
        }),
      ]);
      await service.fullSync();
      expect(model.findOneAndUpdate.mock.calls[0][1].$set).toMatchObject({
        price: 1600,
        priceLabel: 'Pauschalmiete',
        pricePeriod: expected,
        verfuegbar_ab: new Date('2026-12-01'),
        verfuegbarAbText: 'Dezember',
        rentalStatus: 'vacant',
        rentalStatusLabel: 'leerstehend',
      });
    },
  );

  it('uses formatted German selections when the account provides no permitted-value dictionary', async () => {
    mockApi([estate(1, { objekttyp: 'internal_unknown_code' })]);
    const original = http.post.getMockImplementation()!;
    http.post.mockImplementation((url, body) =>
      body.request.actions[0].parameters.formatoutput
        ? of(response([estate(1, { objekttyp: 'Etagenwohnung' })]))
        : original(url, body),
    );
    await service.fullSync();
    expect(model.findOneAndUpdate.mock.calls[0][1].$set.objekttypLabel).toBe(
      'Etagenwohnung',
    );
  });

  it('never deactivates existing properties after an individual database write fails', async () => {
    mockApi([estate(1), estate(2)]);
    model.findOneAndUpdate.mockRejectedValueOnce(
      new Error('database write failed'),
    );
    expect(await service.fullSync()).toMatchObject({
      synced: 1,
      errors: 1,
      complete: false,
      deactivated: 0,
    });
    expect(model.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    { name: 'missing count', result: response([], null) },
    { name: 'truncated result', result: response([estate(1)], 2) },
    {
      name: 'unpublished record',
      result: response([estate(1, { veroeffentlichen: 0 })]),
    },
    { name: 'inactive record', result: response([estate(1, { status: 0 })]) },
    {
      name: 'missing records',
      result: {
        data: {
          response: { results: [{ status: { errorcode: 0 }, data: {} }] },
        },
      },
    },
  ])('rejects $name before writing or deactivating', async ({ result }) => {
    mockApi([]);
    const original = http.post.getMockImplementation()!;
    http.post.mockImplementation((url, body) =>
      body.request.actions[0].resourcetype === 'estate'
        ? of(result)
        : original(url, body),
    );
    await expect(service.fullSync()).rejects.toThrow();
    expect(model.findOneAndUpdate).not.toHaveBeenCalled();
    expect(model.updateMany).not.toHaveBeenCalled();
  });

  it('uses the same filters for listing and map, with an extra coordinate restriction for pins', async () => {
    const filters = {
      searchTerm: 'Wohnung',
      district: 'Düsseldorf',
      vermarktungsart: 'kauf',
      minPrice: '200000',
      maxPrice: '400000',
      availableFrom: '2026-11-01',
    };
    await service.getEstatesFromDB(filters, { limit: 1000 });
    const listConditions = model.find.mock.calls[0][0];
    await service.getMapPins(filters);
    expect(model.find.mock.calls[1][0]).toMatchObject(listConditions);
    expect(listConditions.veroeffentlichen).toEqual({ $in: ['1', 'true'] });
    expect(
      listConditions.$and[1].$expr.$and[0].$gt[0].$switch.branches[0],
    ).toEqual({
      case: { $eq: ['$vermarktungsart', 'kauf'] },
      then: '$kaufpreis',
    });
    expect(model.find.mock.calls[1][0].breitengrad).toEqual({
      $gte: -90,
      $lte: 90,
      $ne: null,
    });
    expect(model.find.mock.calls[1][0].showGoogleMap).toBe(true);
    expect(listConditions.status2).toEqual({
      $in: ['ind_Schl_2897', 'status2obj_aktiv'],
    });
  });

  it('rejects inventory stock from a response requested for on-market properties', async () => {
    mockApi([estate(1, { status2: 'ind_Schl_3003' })]);
    await expect(service.fullSync()).rejects.toThrow(
      'Unexpected onOffice publication data',
    );
    expect(model.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('supports an explicit all-active-published policy without imposing a target property count', async () => {
    process.env.ONOFFICE_ALLOWED_MARKETING_STATUSES = '*';
    mockApi([estate(1, { status2: 'ind_Schl_3003' })]);
    await expect(service.fullSync()).resolves.toMatchObject({
      synced: 1,
      complete: true,
    });
    const request = http.post.mock.calls.find(
      (call) => call[1].request.actions[0].resourcetype === 'estate',
    )[1];
    expect(
      request.request.actions[0].parameters.filter.status2,
    ).toBeUndefined();
  });

  it.each([
    { maxPrice: 'bad' },
    { minRooms: '-1' },
    { minPrice: '200', maxPrice: '100' },
    { availableFrom: 'bad' },
    { vermarktungsart: 'code_unknown' },
  ])('rejects invalid filters %p', async (filters) => {
    await expect(service.getMapPins(filters)).rejects.toThrow();
    expect(model.find).not.toHaveBeenCalled();
  });

  it('treats district input as literal text rather than a regular expression', async () => {
    await service.getMapPins({ district: 'District (West)' });
    const expression = model.find.mock.calls[0][0].stadtteil;
    expect(expression.test('District (West)')).toBe(true);
    expect(expression.test('District West')).toBe(false);
  });
});
