@echo off
:: Smart Email Agent — Auto-Start Script
:: This script starts the email agent silently in the background.
:: Add it to Windows Task Scheduler to run on login.

cd /d "d:\Projects\Email Agent for Ro"
start /min cmd /c "node src/app.js > data\agent.log 2>&1"
