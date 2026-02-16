import { test, expect } from '@playwright/test'

test.describe('Home Page', () => {
  test('should display the title and project type badges', async ({ page }) => {
    await page.goto('/')

    await expect(page.locator('h1')).toContainText('The Benevolent Dictator')
    await expect(page.locator('h2')).toContainText('The Benevolent Dictator')

    await expect(page.locator('text=新規開発')).toBeVisible()
    await expect(page.locator('text=バグ報告')).toBeVisible()
    await expect(page.locator('text=修正依頼')).toBeVisible()
    await expect(page.locator('text=機能追加')).toBeVisible()
  })

  test('should navigate to new project page on CTA click', async ({ page }) => {
    await page.goto('/')

    await page.click('text=AI 執事に相談する')

    await expect(page).toHaveURL(/\/projects\/new|\/sign-up/)
  })

  test('should have login button', async ({ page }) => {
    await page.goto('/')

    const loginButton = page.locator('text=ログイン')
    await expect(loginButton).toBeVisible()
  })
})
