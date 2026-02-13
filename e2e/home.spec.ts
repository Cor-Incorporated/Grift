import { test, expect } from '@playwright/test'

test.describe('Home Page', () => {
  test('should display the title and project type cards', async ({ page }) => {
    await page.goto('/')

    await expect(page.locator('h1')).toContainText('The Benevolent Dictator')
    await expect(page.locator('h2')).toContainText('どのようなご用件でしょうか')

    const cards = page.locator('[data-slot="card"]')
    await expect(cards).toHaveCount(4)
  })

  test('should navigate to new project page on card click', async ({ page }) => {
    await page.goto('/')

    await page.click('text=新規開発')

    await expect(page).toHaveURL(/\/projects\/new\?type=new_project/)
  })

  test('should have login button', async ({ page }) => {
    await page.goto('/')

    const loginButton = page.locator('text=ログイン')
    await expect(loginButton).toBeVisible()
  })
})
