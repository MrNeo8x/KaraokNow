import { maskContactData, maskEmail, maskPhone } from './support-mask.interceptor';

describe('support session masking (PD-045)', () => {
  it('masks phones and emails partially', () => {
    expect(maskPhone('+84912345678')).toBe('0912•••678');
    expect(maskPhone('0912345678')).toBe('0912•••678');
    expect(maskPhone('12345')).toBe('•••••');
    expect(maskEmail('nam.nguyen@gmail.com')).toBe('n•••@gmail.com');
    expect(maskEmail('broken')).toBe('•••');
  });
  it('walks nested responses and keeps other fields, including the branch phone', () => {
    const out = maskContactData({ items: [{ id: 'h1', customerPhone: '+84912345678', customerEmail: 'a@b.vn', phone: '+84989015619' }],
      members: [{ email: 'staff@x.vn', displayName: 'Lan' }], at: new Date(0), n: 1, nil: null });
    expect(out).toEqual({ items: [{ id: 'h1', customerPhone: '0912•••678', customerEmail: 'a•••@b.vn', phone: '+84989015619' }],
      members: [{ email: 's•••@x.vn', displayName: 'Lan' }], at: new Date(0), n: 1, nil: null });
  });
});
