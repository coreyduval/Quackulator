@echo off
cd /d "%~dp0"
cargo build --release || (pause & exit /b 1)
cargo run --release -- parity
cargo run --release -- sim --games 2000
cargo run --release -- train --games 10000 --passes 6 --out weights.json
cargo run --release -- sim --games 2000 --weights weights.json
python install_weights.py weights.json
pause
