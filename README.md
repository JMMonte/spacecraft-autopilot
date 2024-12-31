# Space Simulator

A Three.js-based space simulator with realistic physics and an autopilot system.

## Features

- Realistic spacecraft physics simulation using CANNON.js
- Advanced autopilot system with multiple control modes
- Realistic RCS thruster visualization
- Beautiful space environment with HDR background
- Intuitive cockpit UI with React and Tailwind CSS

## Getting Started

### Prerequisites

- Node.js (v14 or higher)
- npm (v6 or higher)

### Installation

1. Clone the repository:

    ```bash
    git clone https://github.com/yourusername/space-simulator.git
    cd space-simulator
    ```

2. Install dependencies:

    ```bash
    npm install
    ```

3. Start the development server:

    ```bash
    npm run dev
    ```

## Controls

### Manual Control

- W/S: Forward/Backward thrust
- A/D: Left/Right thrust
- Q/E: Up/Down thrust
- Arrow keys: Pitch and Yaw
- Z/X: Roll left/right
- Shift: Increase thrust
- Space: Emergency stop

### Autopilot Modes

- Cancel & Align: Stops rotation and aligns with the current orientation
- Cancel Rotation: Stops all rotational movement
- Point to Position: Points the spacecraft towards a target position
- Cancel Linear Motion: Stops all linear movement
- Go to Position: Moves the spacecraft to a target position

## Project Structure

```plaintext
space-simulator/
├── public/
│   ├── images/
│   │   ├── effects/     # Lens flare and visual effects
│   │   ├── panoramas/   # Space background panoramas
│   │   └── textures/    # General textures
│   └── config.json      # Application configuration
├── src/
│   ├── components/      # React components
│   ├── controllers/     # Spacecraft control logic
│   ├── helpers/         # Utility functions
│   ├── js/             # Core simulation code
│   ├── scenes/         # Three.js scene setup
│   ├── styles/         # CSS and Tailwind styles
│   └── ui/             # UI-related code
└── package.json
```

## License

This project is licensed under the ISC License.
