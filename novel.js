window.onload = function() {
const contentDiv = document.getElementById("content-nav");
const xhr = new XMLHttpRequest();
xhr.open("GET", "https://jimmy-shian.github.io/novel/nav.txt", true);
xhr.onreadystatechange = function() {
    if (xhr.readyState === XMLHttpRequest.DONE || xhr.status === 200) {
    contentDiv.innerHTML = xhr.responseText;
    }
};
xhr.send();

const contentEnd = document.getElementById("content-end");

const end = new XMLHttpRequest();
end.open("GET", "https://jimmy-shian.github.io/novel/end.txt", true);
end.onreadystatechange = function() {
    if (end.readyState === XMLHttpRequest.DONE || end.status === 200) {
    contentEnd.innerHTML = end.responseText;
    }
};
end.send();
console.log(contentDiv);
console.log(contentEnd);

};


    // 翻譯index
const cardText = document.querySelector('#cardText');
const changeBtn = document.querySelector('#changeBtn');
console.log(changeBtn);
console.log(cardText);

let isChanged = '0';
        
    changeBtn.addEventListener('click', function() {
        if (isChanged === '0') {
        changeBtn.innerHTML = `翻譯成英文
        `;
        cardText.innerHTML = `
        <br>
        <h4 class="card-title">進入網絡小說世界~</h4>
        
        看啊，一個新的平台到來了，<br>
        虛構的故事正在努力，<br>
        娛樂和迷住思想，<br>
        在文字的世界中，找到一種快樂。<br>
        <br>
        無廣告，內容來源精心，<br>
        由學生使用技術公平，<br>
        網絡小說的世界得到修復，<br>
        並提供難得的閱讀體驗。<br>
        <br>
        親愛的讀者，來吧，坐下來，<br>
        喝一杯你最喜歡的飲料，<br>
        讓自己沉浸在這個如此甜蜜的世界<br>
        裡，冒險和愛情的故事在這里相遇。<br>
        <br>
        享受你的閱讀吧，在這個明亮的地方，讓<br>
        自己沉浸在無盡黑夜的故事中。
    <div class="spacer"></div>

        `;
        isChanged = '1';

        } else {
        changeBtn.innerHTML = `Translate to Chinese
        `;
        cardText.innerHTML = `
        `;
        isChanged = '0';
        }
    });
//展開目錄
const openBtn = document.querySelector('#openBtn');
const tablelist = document.querySelector("#table-list");
const loadingIndicator = document.querySelector('#loading-indicator');

let tablechange = '0';
openBtn.addEventListener('click', function() {
    if (tablechange === '0') {
        fetch("table.txt")
        .then(response => {
            if (!response.ok) {
                throw new Error("Network response was not ok");
            }
            return response.text();
        })
        .then(data => {
            tablelist.innerHTML = data;
            loadingIndicator.style.display = "none";
        })
        .catch(error => {
            console.error("There was a problem with the fetch operation:", error);
            loadingIndicator.style.display = "none";
        });
        tablechange = '1';
    } else {
        tablelist.innerHTML = ``;
        tablechange = '0';
    }
table.send();
console.log(tablelist);
});
// window.onload = function() {

//     };

