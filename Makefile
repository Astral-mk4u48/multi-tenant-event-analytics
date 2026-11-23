.PHONY: dev test migrate bench build clean up down

dev:
	docker compose up -d postgres redis
	npm run dev

up:
	docker compose up -d

down:
	docker compose down

migrate:
	npm run db:migrate

test:
	npm run test

bench:
	node scripts/load-test.js

build:
	npm run build

clean:
	docker compose down -v
