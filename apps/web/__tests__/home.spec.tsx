import { render, screen } from '@testing-library/react';

import '@testing-library/jest-dom';
import Home from '../pages/index';

describe('Home', () => {
  it('renders title', () => {
    render(<Home />);
    expect(screen.getByText('WheelPath AI')).toBeInTheDocument();
  });
});
