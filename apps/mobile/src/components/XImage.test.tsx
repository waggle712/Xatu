import { render } from '@testing-library/react-native';
import { ThemeProvider } from '@xatu/ui';
import { XImage } from './XImage';

describe('XImage', () => {
  it('renders a labelled placeholder tile when there is no image (never a broken image)', async () => {
    const screen = await render(
      <ThemeProvider>
        <XImage image={null} accessibilityLabel="Shop cover" />
      </ThemeProvider>,
    );
    expect(screen.getByLabelText('Shop cover')).toBeTruthy();
  });
});
