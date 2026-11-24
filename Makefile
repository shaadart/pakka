.PHONY: up down logs test verify

up:
	@test -f .env || echo "No .env file. Copy .env.example to .env and add real keys, or every reply will be a 503."
	docker compose up -d --build
	@echo "backend  http://localhost:8000/health"
	@echo "frontend http://localhost:3000"

down:
	docker compose down

logs:
	docker compose logs -f

# Backend tests, inside the image's `test` stage. No local Python needed.
test:
	docker build --target test -t pakka-backend-test backend
	docker run --rm pakka-backend-test

# Check every contract rule against a running backend (needs Node 18+):
#   make verify URL=https://your-backend      add ARGS=--no-memory when the backend uses LLM_MOCK_RESPONSE
verify:
	@node scripts/verify.mjs $(or $(URL),http://localhost:8000) $(ARGS)
