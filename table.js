const openBtn = document.querySelector('#openBtn');
const tablelist = document.querySelector('#table-list');
const loadingIndicator = document.querySelector('#loading-indicator');
let isOpen = '0';

    openBtn.addEventListener('click', function() {
    if (isOpen === '0') {
    // 显示加载指示器
    loadingIndicator.style.display = 'block';

    const table = new XMLHttpRequest();
    table.open('GET', 'table.txt', true);
    table.onreadystatechange = function() {
        if (table.readyState === XMLHttpRequest.DONE) {
        // 隐藏加载指示器
        loadingIndicator.style.display = 'none';

        if (table.status === 200) {
            tablelist.innerHTML = table.responseText;
            openBtn.innerHTML = `收起章節列表
            `;
            isOpen = '1';
        } else {
            tablelist.innerHTML = '加載數據失敗，请稍后重试。';
        }
        }
    };
    table.send();
    } else {
    openBtn.innerHTML = `展開章節列表
    `;
    tablelist.innerHTML = `
    `;
    isOpen = '0';
    }

    });
