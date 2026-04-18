import { describe, it, expect, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import DemoBanner from './DemoBanner.vue';

describe('DemoBanner', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('renders by default when the dismiss flag is unset', () => {
    const w = mount(DemoBanner);
    expect(w.find('[data-testid="demo-banner"]').exists()).toBe(true);
    expect(w.text()).toContain('Live demo');
  });

  it('hides itself and persists the dismissal to sessionStorage on click', async () => {
    const w = mount(DemoBanner);
    await w.get('button').trigger('click');
    expect(w.find('[data-testid="demo-banner"]').exists()).toBe(false);
    expect(sessionStorage.getItem('smoothfs.demo-banner.dismissed')).toBe('1');
  });

  it('stays hidden when sessionStorage already has the dismissal flag', () => {
    sessionStorage.setItem('smoothfs.demo-banner.dismissed', '1');
    const w = mount(DemoBanner);
    expect(w.find('[data-testid="demo-banner"]').exists()).toBe(false);
  });
});
