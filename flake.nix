{
  description = "Bookmark RAG Extension development environment and E2E tests";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};

        # Common packages for development and testing
        commonPackages = with pkgs; [
          nodejs_22
          deno
          chromium
        ];

        # Test-specific packages
        testPackages = with pkgs; [
          xvfb-run
        ];

        # Script to run E2E server sync tests (runs in current directory)
        runE2EServerSync = pkgs.writeShellScriptBin "run-e2e-server-sync" ''
          set -e

          export BROWSER_PATH="${pkgs.chromium}/bin/chromium"
          export PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=1
          export NODE_ENV=development
          export OPENAI_API_KEY="''${OPENAI_API_KEY:-test-key-for-mock}"
          export PATH="${pkgs.nodejs_22}/bin:${pkgs.deno}/bin:$PATH"

          # Ensure we're in a bookmarks project directory
          if [ ! -f "package.json" ] || [ ! -d "server" ]; then
            echo "Error: Must be run from the bookmarks project root directory"
            echo "Current directory: $(pwd)"
            exit 1
          fi

          # Ensure dependencies are installed
          if [ ! -d "node_modules" ] || [ ! -f "node_modules/.package-lock.json" ]; then
            echo "Installing npm dependencies..."
            npm install
          fi

          # Build extension if not built or if source is newer
          if [ ! -d "dist-chrome" ] || [ "$(find src -newer dist-chrome -type f 2>/dev/null | head -1)" ]; then
            echo "Building Chrome extension..."
            npx vite build --config vite.config.chrome.ts
          fi

          echo "Running E2E server sync tests..."
          ${pkgs.xvfb-run}/bin/xvfb-run \
            --auto-servernum \
            --server-args="-screen 0 1920x1080x24" \
            npx tsx tests/e2e-server-sync.test.ts
        '';

        # Script to run all E2E tests (runs in current directory)
        runE2EAll = pkgs.writeShellScriptBin "run-e2e-all" ''
          set -e

          export BROWSER_PATH="${pkgs.chromium}/bin/chromium"
          export PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=1
          export NODE_ENV=development
          export OPENAI_API_KEY="''${OPENAI_API_KEY:-test-key-for-mock}"
          export PATH="${pkgs.nodejs_22}/bin:${pkgs.deno}/bin:$PATH"

          # Ensure we're in a bookmarks project directory
          if [ ! -f "package.json" ]; then
            echo "Error: Must be run from the bookmarks project root directory"
            exit 1
          fi

          # Ensure dependencies are installed
          if [ ! -d "node_modules" ] || [ ! -f "node_modules/.package-lock.json" ]; then
            echo "Installing npm dependencies..."
            npm install
          fi

          # Build extension
          echo "Building Chrome extension..."
          npx vite build --config vite.config.chrome.ts

          echo "Running all E2E tests..."
          ${pkgs.xvfb-run}/bin/xvfb-run \
            --auto-servernum \
            --server-args="-screen 0 1920x1080x24" \
            npx tsx tests/e2e.test.ts
        '';

        # Script to start the server (runs in current directory)
        runServer = pkgs.writeShellScriptBin "run-server" ''
          set -e
          export PATH="${pkgs.deno}/bin:$PATH"

          # Ensure we're in the right directory
          if [ -d "server" ]; then
            cd server
          fi

          if [ ! -f "deno.json" ]; then
            echo "Error: Must be run from bookmarks project root or server directory"
            exit 1
          fi

          echo "Starting Bookmark RAG server..."
          deno task start
        '';

        # Script to start server in dev mode
        runServerDev = pkgs.writeShellScriptBin "run-server-dev" ''
          set -e
          export PATH="${pkgs.deno}/bin:$PATH"

          # Ensure we're in the right directory
          if [ -d "server" ]; then
            cd server
          fi

          if [ ! -f "deno.json" ]; then
            echo "Error: Must be run from bookmarks project root or server directory"
            exit 1
          fi

          echo "Starting Bookmark RAG server in dev mode..."
          deno task dev
        '';

      in
      {
        # Development shell
        devShells.default = pkgs.mkShell {
          buildInputs = commonPackages ++ testPackages;

          shellHook = ''
            export BROWSER_PATH="${pkgs.chromium}/bin/chromium"
            export PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=1
            export CHROMIUM_FLAGS="--no-sandbox --disable-gpu --ozone-platform=x11"

            echo "========================================"
            echo "Bookmark RAG Extension Dev Environment"
            echo "========================================"
            echo ""
            echo "Available tools:"
            echo "  node     - $(node --version)"
            echo "  deno     - $(deno --version | head -1)"
            echo "  chromium - ${pkgs.chromium}/bin/chromium"
            echo ""
            echo "BROWSER_PATH is set to: $BROWSER_PATH"
            echo ""
            echo "Nix apps (run from project root):"
            echo "  nix run .#test-e2e-server-sync  - Run server sync E2E tests"
            echo "  nix run .#test-e2e-all          - Run all E2E tests"
            echo "  nix run .#server                - Start the server"
            echo "  nix run .#server-dev            - Start server in dev mode"
            echo ""
            echo "Or run tests manually:"
            echo "  xvfb-run --auto-servernum --server-args=\"-screen 0 1920x1080x24\" \\"
            echo "    npx tsx tests/e2e-server-sync.test.ts"
            echo ""
          '';
        };

        # Runnable apps
        apps = {
          test-e2e-server-sync = {
            type = "app";
            program = "${runE2EServerSync}/bin/run-e2e-server-sync";
          };

          test-e2e-all = {
            type = "app";
            program = "${runE2EAll}/bin/run-e2e-all";
          };

          server = {
            type = "app";
            program = "${runServer}/bin/run-server";
          };

          server-dev = {
            type = "app";
            program = "${runServerDev}/bin/run-server-dev";
          };
        };

        # Packages
        packages = {
          run-e2e-server-sync = runE2EServerSync;
          run-e2e-all = runE2EAll;
          run-server = runServer;
          run-server-dev = runServerDev;
        };
      }
    );
}
